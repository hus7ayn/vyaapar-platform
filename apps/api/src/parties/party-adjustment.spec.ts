import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PartiesService, PartyAdjustmentInput } from './parties.service';

/**
 * The balance rule for manual adjustments: currentBalance must ALWAYS equal the running sum of the
 * party's ledger rows, because UtilitiesService.verifyData asserts exactly that and its "fix"
 * button OVERWRITES currentBalance with the ledger sum. An adjustment that moved one without the
 * other would look right until the owner pressed Verify-my-data, then silently revert.
 *
 * These tests drive the REAL PartiesService.addAdjustment / normaliseAdjustment. Only Prisma is
 * stubbed — with a stub that reproduces what Postgres would do: `{ increment }` applied to a
 * numeric(14,2) column, and a ledger table that keeps every row.
 */
const D = (v: number | string | Prisma.Decimal) => new Prisma.Decimal(v);

type LedgerRow = {
  partyId: string; entryType: string; amount: Prisma.Decimal; balance: Prisma.Decimal;
  description: string; entryDate: Date; branchId: string | null;
};

/** A one-party in-memory Prisma double. */
function makeDb(opening = 0) {
  const party = {
    id: 'P1', businessId: 'B1', branchId: 'BR1', name: 'Sharma Traders',
    deletedAt: null as Date | null, currentBalance: D(opening),
  };
  const ledger: LedgerRow[] = [];
  const locks: string[] = [];

  const tx = {
    $executeRaw: (_s: TemplateStringsArray, ...v: unknown[]) => { locks.push(String(v[0])); return Promise.resolve(1); },
    party: {
      update: ({ data }: { where: { id: string }; data: { currentBalance: { increment: Prisma.Decimal } } }) => {
        // numeric(14,2): Postgres rounds the stored value to 2dp.
        party.currentBalance = party.currentBalance.add(data.currentBalance.increment).toDecimalPlaces(2);
        return Promise.resolve({ ...party });
      },
    },
    partyLedgerEntry: {
      create: ({ data }: { data: LedgerRow }) => {
        const row = { ...data, amount: D(data.amount).toDecimalPlaces(2), balance: D(data.balance).toDecimalPlaces(2) };
        ledger.push(row);
        return Promise.resolve({ id: `L${ledger.length}`, ...row });
      },
    },
  };

  const prisma = {
    party: { findFirst: () => Promise.resolve({ ...party }) },
    $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  };

  return { prisma, party, ledger, locks };
}

/** What verifyData would compute: Σ of every ledger row's signed amount. */
const ledgerSum = (ledger: LedgerRow[]) =>
  ledger.reduce((s, e) => s.add(e.amount), D(0)).toDecimalPlaces(2);

describe('party balance adjustments', () => {
  const run = (db: ReturnType<typeof makeDb>, body: PartyAdjustmentInput) =>
    new PartiesService(db.prisma as never).addAdjustment('B1', 'P1', body);

  // ─── direction → sign ────────────────────────────────────────────────────

  it('TO_PAY records a payable: the balance moves NEGATIVE by the amount', async () => {
    const db = makeDb(0);
    const { party, entry } = await run(db, { amount: 8000, direction: 'TO_PAY' });
    expect(Number(entry.amount)).toBe(-8000);
    expect(Number(party.currentBalance)).toBe(-8000);
    expect(Number(entry.balance)).toBe(-8000); // the row carries the POST-move balance
    expect(entry.entryType).toBe('ADJUSTMENT');
  });

  it('TO_RECEIVE records a receivable: the balance moves POSITIVE', async () => {
    const db = makeDb(0);
    const { party, entry } = await run(db, { amount: 8000, direction: 'TO_RECEIVE' });
    expect(Number(entry.amount)).toBe(8000);
    expect(Number(party.currentBalance)).toBe(8000);
  });

  it('new supplier debt ADDS to the debt already outstanding (it does not replace it)', async () => {
    const db = makeDb(-12500); // already owe ₹12,500
    const { party } = await run(db, { amount: 8000, direction: 'TO_PAY' });
    expect(Number(party.currentBalance)).toBe(-20500);
  });

  it('TO_RECEIVE against a payable corrects it downward and can cross zero', async () => {
    const db = makeDb(-2000);
    expect(Number((await run(db, { amount: 500, direction: 'TO_RECEIVE' })).party.currentBalance)).toBe(-1500);
    expect(Number((await run(db, { amount: 2500, direction: 'TO_RECEIVE' })).party.currentBalance)).toBe(1000);
  });

  it('serialises on the party id and writes the balance and the ledger row exactly once each', async () => {
    const db = makeDb(0);
    await run(db, { amount: 100, direction: 'TO_PAY' });
    expect(db.locks).toEqual(['P1']); // pg_advisory_xact_lock(hashtext(partyId))
    expect(db.ledger).toHaveLength(1);
  });

  // ─── the invariant verifyData enforces ───────────────────────────────────

  it('balance == running ledger sum after a long mixed run of adjustments', async () => {
    const db = makeDb(0);
    db.ledger.push({ // the OPENING row party creation writes, so the sum starts complete
      partyId: 'P1', entryType: 'OPENING', amount: D(0), balance: D(0),
      description: 'Opening balance', entryDate: new Date(), branchId: 'BR1',
    });
    const moves: PartyAdjustmentInput[] = [
      { amount: 8000, direction: 'TO_PAY' },
      { amount: 1249.99, direction: 'TO_PAY' },
      { amount: 333.33, direction: 'TO_RECEIVE' },
      { amount: 0.01, direction: 'TO_PAY' },
      { amount: 12345.67, direction: 'TO_PAY' },
      { amount: 9999.99, direction: 'TO_RECEIVE' },
      { amount: 0.05, direction: 'TO_RECEIVE' },
    ];
    let last = D(0);
    for (const m of moves) {
      const { party, entry } = await run(db, m);
      // every row's `balance` is the running total up to and including itself
      expect(Number(entry.balance)).toBe(Number(ledgerSum(db.ledger)));
      expect(Number(entry.balance)).toBe(Number(last.add(entry.amount).toDecimalPlaces(2)));
      last = D(party.currentBalance);
    }
    // what verifyData compares — drift here is what its "fix" button would overwrite
    expect(Number(db.party.currentBalance)).toBe(Number(ledgerSum(db.ledger)));
    expect(Number(db.party.currentBalance)).toBe(-11262.3);
  });

  it('opening balance + adjustments still reconcile (the fix button finds no drift)', async () => {
    const db = makeDb(-5000);
    db.ledger.push({
      partyId: 'P1', entryType: 'OPENING', amount: D(-5000), balance: D(-5000),
      description: 'Opening balance', entryDate: new Date(), branchId: 'BR1',
    });
    await run(db, { amount: 2500.5, direction: 'TO_PAY' });
    await run(db, { amount: 1000.25, direction: 'TO_RECEIVE' });
    expect(Number(db.party.currentBalance)).toBe(-6500.25);
    expect(Number(ledgerSum(db.ledger))).toBe(-6500.25);
  });

  it('no Txn is created — the adjustment is a ledger row only', async () => {
    const db = makeDb(0);
    const { entry } = await run(db, { amount: 500, direction: 'TO_PAY' });
    expect((entry as { txnId?: string }).txnId).toBeUndefined();
    expect(entry.branchId).toBe('BR1'); // inherits the party's branch, so branch-scoped reads see it
  });

  // ─── hand validation (the global ValidationPipe is bypassed) ─────────────

  it('rounds the amount to paisa before it reaches a numeric(14,2) column', async () => {
    const db = makeDb(0);
    const { entry } = await run(db, { amount: 100.005, direction: 'TO_PAY' });
    expect(Number(entry.amount)).toBe(-100.01);
    expect(Number(db.party.currentBalance)).toBe(Number(ledgerSum(db.ledger)));
  });

  it('defaults the description, and keeps a note when given', async () => {
    const db = makeDb(0);
    expect((await run(db, { amount: 1, direction: 'TO_PAY' })).entry.description).toBe('Manual adjustment');
    expect((await run(db, { amount: 1, direction: 'TO_PAY', note: '  Diwali stock  ' })).entry.description).toBe('Diwali stock');
  });

  it('honours an explicit entry date and defaults to now', async () => {
    const db = makeDb(0);
    const dated = await run(db, { amount: 1, direction: 'TO_PAY', date: '2026-03-05' });
    expect(dated.entry.entryDate.toISOString().slice(0, 10)).toBe('2026-03-05');
    const now = await run(db, { amount: 1, direction: 'TO_PAY' });
    expect(Math.abs(now.entry.entryDate.getTime() - Date.now())).toBeLessThan(5000);
  });

  it.each([
    ['zero', { amount: 0, direction: 'TO_PAY' }],
    ['negative (sign belongs to direction, not the amount)', { amount: -500, direction: 'TO_PAY' }],
    ['rounds to zero', { amount: 0.004, direction: 'TO_PAY' }],
    ['NaN', { amount: Number.NaN, direction: 'TO_PAY' }],
    ['Infinity', { amount: Number.POSITIVE_INFINITY, direction: 'TO_PAY' }],
    ['missing', { direction: 'TO_PAY' }],
    ['not a number', { amount: 'lots', direction: 'TO_PAY' }],
    ['null', { amount: null, direction: 'TO_PAY' }],
    ['an object', { amount: { v: 1 }, direction: 'TO_PAY' }],
    ['overflows numeric(14,2)', { amount: 1e12, direction: 'TO_PAY' }],
    ['a bad direction', { amount: 100, direction: 'TO_PAI' }],
    ['a lowercase direction', { amount: 100, direction: 'to_pay' }],
    ['a missing direction', { amount: 100 }],
    ['an unparseable date', { amount: 100, direction: 'TO_PAY', date: 'yesterday' }],
  ])('rejects %s and writes nothing', async (_label, body) => {
    const db = makeDb(-1000);
    await expect(run(db, body as unknown as PartyAdjustmentInput)).rejects.toThrow(BadRequestException);
    expect(Number(db.party.currentBalance)).toBe(-1000);
    expect(db.ledger).toHaveLength(0);
  });

  it('accepts a numeric string amount (what a form input sends)', async () => {
    const db = makeDb(0);
    const { entry } = await run(db, { amount: '8000.50' as unknown as number, direction: 'TO_PAY' });
    expect(Number(entry.amount)).toBe(-8000.5);
  });
});
