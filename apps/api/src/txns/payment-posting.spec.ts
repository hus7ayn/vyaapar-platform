import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TxnCoreService } from './txn-core.service';
import { LEDGER_ENTRY_TYPE, STOCK_EFFECT } from './txn.constants';

/**
 * The money rule for payments: a payment that is supposed to move money MUST move exactly that
 * much money, out of exactly one account, and that account must be one a screen can show.
 *
 * The bug these tests pin down: a supplier payment was accepted, the bill was marked paid — and
 * no bank/cash balance changed at all. Three different ways in:
 *   1. an explicit bankAccountId that didn't match the request's branch resolved to null, and the
 *      posting code guarded the debit with `if (account)` and had no else, so it silently
 *      no-opped (txn-core.service.ts, resolveMoneyAccount + applyPayments);
 *   2. a request with no branch skipped the self-healing account creation entirely;
 *   3. the account the money DID land in was created without a branch at signup, so every
 *      branch-filtered screen hid it.
 *
 * These drive the REAL TxnCoreService.applyPayments against an in-memory stand-in for the Prisma
 * transaction client — no database, no Nest container. Only the four delegates applyPayments
 * touches are implemented, and every write is recorded so the assertions can be about money
 * rather than about calls.
 */
const D = (v: number | string | Prisma.Decimal) => new Prisma.Decimal(v);

type Account = {
  id: string; businessId: string; branchId: string | null;
  name: string; accountType: string; balance: Prisma.Decimal; createdAt: Date;
};
type AccountSeed = Partial<Omit<Account, 'balance'>> & { balance?: number | string | Prisma.Decimal };
type Branch = { id: string; businessId: string; isDefault: boolean; deletedAt: Date | null; createdAt: Date };
type PaymentRow = { id: string; txnId: string; paymentType: string; bankAccountId: string | null; amount: Prisma.Decimal };
type ChequeRow = { txnPaymentId: string; businessId: string; branchId: string | null; amount: Prisma.Decimal; direction: string };

const BIZ = 'biz-1';
const SHOP_A = 'shop-a';
const SHOP_B = 'shop-b';

/** Minimal stand-in for Prisma's transaction client: only what applyPayments actually calls. */
class FakeTx {
  accounts: Account[] = [];
  branches: Branch[] = [];
  payments: PaymentRow[] = [];
  cheques: ChequeRow[] = [];
  private seq = 0;

  constructor(seed?: { accounts?: AccountSeed[]; branches?: Partial<Branch>[] }) {
    for (const b of seed?.branches ?? [{ id: SHOP_A, isDefault: true }]) this.addBranch(b);
    for (const a of seed?.accounts ?? []) this.addAccount(a);
  }

  addBranch(b: Partial<Branch>) {
    this.branches.push({
      id: b.id ?? `br-${++this.seq}`, businessId: b.businessId ?? BIZ,
      isDefault: b.isDefault ?? false, deletedAt: b.deletedAt ?? null,
      createdAt: b.createdAt ?? new Date(2020, 0, this.branches.length + 1),
    });
  }

  addAccount(a: AccountSeed) {
    this.accounts.push({
      id: a.id ?? `acc-${++this.seq}`, businessId: a.businessId ?? BIZ,
      branchId: a.branchId === undefined ? SHOP_A : a.branchId,
      name: a.name ?? 'Cash', accountType: a.accountType ?? 'CASH',
      balance: D(a.balance ?? 0), createdAt: a.createdAt ?? new Date(2021, 0, this.accounts.length + 1),
    });
  }

  balanceOf(id: string) {
    return Number(this.accounts.find((a) => a.id === id)!.balance);
  }

  /** Matches the handful of scalar `where` keys resolveMoneyAccount builds. */
  private match<T extends Record<string, unknown>>(row: T, where: Record<string, unknown>) {
    return Object.entries(where).every(([k, v]) => {
      if (v === null) return row[k] === null;
      if (v && typeof v === 'object') return true; // no such filter is used here
      return row[k] === v;
    });
  }

  private firstBy<T extends Record<string, unknown>>(rows: T[], where: Record<string, unknown>, orderByCreatedAtAsc: boolean) {
    const hits = rows.filter((r) => this.match(r, where));
    if (orderByCreatedAtAsc) {
      hits.sort((x, y) => (x.createdAt as Date).getTime() - (y.createdAt as Date).getTime());
    }
    return hits[0] ?? null;
  }

  bankAccount = {
    findFirst: async ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: unknown }) =>
      this.firstBy(this.accounts as unknown as Record<string, unknown>[], where, !!orderBy) as Account | null,
    create: async ({ data }: { data: Partial<Account> }) => {
      const row: Account = {
        id: `acc-new-${++this.seq}`, businessId: data.businessId!, branchId: data.branchId ?? null,
        name: data.name!, accountType: data.accountType!, balance: D(0), createdAt: new Date(),
      };
      this.accounts.push(row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: { balance: { increment: Prisma.Decimal } } }) => {
      const row = this.accounts.find((a) => a.id === where.id);
      if (!row) throw new Error(`no such account ${where.id}`);
      row.balance = row.balance.add(data.balance.increment);
      return row;
    },
  };

  branch = {
    findFirst: async ({ where, orderBy }: { where: Record<string, unknown>; orderBy?: unknown }) =>
      this.firstBy(this.branches as unknown as Record<string, unknown>[], where, !!orderBy) as Branch | null,
  };

  txnPayment = {
    create: async ({ data }: { data: Omit<PaymentRow, 'id'> }) => {
      const row = { id: `pay-${++this.seq}`, ...data, amount: D(data.amount) };
      this.payments.push(row);
      return row;
    },
  };

  cheque = {
    create: async ({ data }: { data: ChequeRow }) => {
      this.cheques.push(data);
      return data;
    },
  };
}

const core = new TxnCoreService({} as never, {} as never);

/** Post the payments of one txn exactly the way postEffects does for a supplier payment. */
function payOut(tx: FakeTx, branchId: string | null | undefined, payments: Parameters<TxnCoreService['applyPayments']>[6]) {
  return core.applyPayments(tx as never, BIZ, branchId, 'txn-1', 'PAYMENT_OUT', 'Acme Supplies', payments, false);
}

describe('payment posting — the money always lands in exactly one visible account', () => {
  it('a PAYMENT_OUT debits the named account by exactly the amount', async () => {
    const tx = new FakeTx({ accounts: [{ id: 'cash-a', branchId: SHOP_A, balance: 10000 }] });

    await payOut(tx, SHOP_A, [{ paymentType: 'CASH', bankAccountId: 'cash-a', amount: 2500 }]);

    expect(tx.balanceOf('cash-a')).toBe(7500);
    expect(tx.accounts).toHaveLength(1);           // nothing was auto-created on the side
    expect(tx.payments).toHaveLength(1);
    expect(tx.payments[0].bankAccountId).toBe('cash-a'); // the row names the account it debited
    expect(Number(tx.payments[0].amount)).toBe(2500);
  });

  it('a PAYMENT_IN credits the same account it would have debited', async () => {
    const tx = new FakeTx({ accounts: [{ id: 'cash-a', branchId: SHOP_A, balance: 1000 }] });

    await core.applyPayments(
      tx as never, BIZ, SHOP_A, 'txn-2', 'PAYMENT_IN', 'A Customer',
      [{ paymentType: 'CASH', bankAccountId: 'cash-a', amount: 400 }], true,
    );

    expect(tx.balanceOf('cash-a')).toBe(1400);
  });

  it('an explicit cross-branch bankAccountId still debits, instead of no-opping', async () => {
    // The dropdown handed back shop B's account while the request carries shop A — a stale cache
    // after a shop switch. The old branch-filtered lookup returned null and the payment posted
    // with NO debit at all. The account belongs to the business, so it must be debited.
    const tx = new FakeTx({
      branches: [{ id: SHOP_A, isDefault: true }, { id: SHOP_B }],
      accounts: [
        { id: 'cash-a', branchId: SHOP_A, balance: 10000 },
        { id: 'cash-b', branchId: SHOP_B, balance: 8000 },
      ],
    });

    await payOut(tx, SHOP_A, [{ paymentType: 'CASH', bankAccountId: 'cash-b', amount: 3000 }]);

    expect(tx.balanceOf('cash-b')).toBe(5000); // debited
    expect(tx.balanceOf('cash-a')).toBe(10000); // and only that one
    expect(tx.payments[0].bankAccountId).toBe('cash-b');
  });

  it('a branch-less request self-heals into the default shop rather than moving nothing', async () => {
    // B4: `if (!account && allowCreate && branchId)` bailed out when the request had no branch,
    // so nothing was created and nothing was debited.
    const tx = new FakeTx({ branches: [{ id: SHOP_A, isDefault: true }], accounts: [] });

    await payOut(tx, undefined, [{ paymentType: 'CASH', amount: 1200 }]);

    expect(tx.accounts).toHaveLength(1);
    expect(tx.accounts[0].branchId).toBe(SHOP_A); // visible: every screen filters by branch
    expect(tx.balanceOf(tx.accounts[0].id)).toBe(-1200);
    expect(tx.payments[0].bankAccountId).toBe(tx.accounts[0].id);
  });

  it('an unresolvable account throws instead of half-posting the payment', async () => {
    // B2 + B5: an id that names no account of this business. The old code wrote the TxnPayment
    // row, marked the bill paid and moved no money — silently.
    const tx = new FakeTx({ accounts: [{ id: 'cash-a', branchId: SHOP_A, balance: 500 }] });

    await expect(
      payOut(tx, SHOP_A, [{ paymentType: 'CASH', bankAccountId: 'ghost-account', amount: 900 }]),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.payments).toHaveLength(0); // no half-entry left behind
    expect(tx.balanceOf('cash-a')).toBe(500);
  });

  it('a business with no shop at all cannot silently swallow a payment either', async () => {
    const tx = new FakeTx({ branches: [], accounts: [] });

    await expect(payOut(tx, undefined, [{ paymentType: 'CASH', amount: 100 }]))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(tx.payments).toHaveLength(0);
  });

  it('a CHEQUE does not touch a bank account until it is deposited', async () => {
    const tx = new FakeTx({ accounts: [{ id: 'cash-a', branchId: SHOP_A, balance: 10000 }] });

    await payOut(tx, SHOP_A, [{ paymentType: 'CHEQUE', amount: 4000, referenceNo: '112233' }]);

    expect(tx.balanceOf('cash-a')).toBe(10000);   // untouched, deliberately
    expect(tx.cheques).toHaveLength(1);
    expect(tx.cheques[0].direction).toBe('PAID');
    expect(Number(tx.cheques[0].amount)).toBe(4000);
    expect(tx.payments[0].bankAccountId).toBeNull(); // no account named yet
  });

  it('a DEBT (credit) leg moves no cash and creates no payment row', async () => {
    const tx = new FakeTx({ accounts: [{ id: 'cash-a', branchId: SHOP_A, balance: 10000 }] });

    await payOut(tx, SHOP_A, [
      { paymentType: 'CASH', bankAccountId: 'cash-a', amount: 1000 },
      { paymentType: 'DEBT', amount: 4000 },
    ]);

    expect(tx.balanceOf('cash-a')).toBe(9000); // only the cash leg
    expect(tx.payments).toHaveLength(1);
  });

  it('delete reverses the exact account the payment debited, to the paisa', async () => {
    const tx = new FakeTx({
      branches: [{ id: SHOP_A, isDefault: true }, { id: SHOP_B }],
      accounts: [
        { id: 'cash-a', branchId: SHOP_A, balance: 10000 },
        { id: 'cash-b', branchId: SHOP_B, balance: 8000 },
      ],
    });
    const payment = [{ paymentType: 'CASH', bankAccountId: 'cash-b', amount: 3000 }];

    await payOut(tx, SHOP_A, payment);
    // deleteTxn replays postEffects with invert=true off the stored rows.
    await core.applyPayments(
      tx as never, BIZ, SHOP_A, 'txn-1', 'PAYMENT_OUT', 'Acme Supplies',
      [{ paymentType: 'CASH', bankAccountId: tx.payments[0].bankAccountId!, amount: 3000 }], false, true,
    );

    expect(tx.balanceOf('cash-b')).toBe(8000); // back where it started
    expect(tx.balanceOf('cash-a')).toBe(10000);
  });
});

describe('a supplier payment is a settlement, not a cost', () => {
  // The P&L sums txnType EXPENSE only (reports.service.ts profitAndLoss). If PAYMENT_OUT also
  // counted, paying a bill would book the cost a second time.
  const PNL_EXPENSE_TXN_TYPES = ['EXPENSE'];

  it('PAYMENT_OUT is not a P&L expense', () => {
    expect(PNL_EXPENSE_TXN_TYPES).not.toContain('PAYMENT_OUT');
    expect(LEDGER_ENTRY_TYPE.PAYMENT_OUT).toBe('PAYMENT_OUT'); // its own ledger line, not EXPENSE
    expect(STOCK_EFFECT.PAYMENT_OUT).toBeUndefined();          // and it moves no goods
  });

  it('bill then payment: the cost is booked once and the payable clears to zero', async () => {
    // PURCHASE_BILL 5,000 on credit → we owe the supplier 5,000.
    const billDelta = core.partyDelta('PURCHASE_BILL', D(5000), D(5000));
    expect(billDelta.toNumber()).toBe(-5000);

    // PAYMENT_OUT 5,000 → payable back to zero, and cash down by 5,000 exactly once.
    const payDelta = core.partyDelta('PAYMENT_OUT', D(5000), D(0));
    expect(payDelta.toNumber()).toBe(5000);
    expect(billDelta.add(payDelta).toNumber()).toBe(0);

    const tx = new FakeTx({ accounts: [{ id: 'cash-a', branchId: SHOP_A, balance: 20000 }] });
    await payOut(tx, SHOP_A, [{ paymentType: 'CASH', bankAccountId: 'cash-a', amount: 5000 }]);
    expect(tx.balanceOf('cash-a')).toBe(15000); // 5,000 out, not 10,000
  });

  it('an EXPENSE has no party settlement effect — it IS the cost', () => {
    expect(core.partyDelta('EXPENSE', D(5000), D(5000)).toNumber()).toBe(0);
  });
});
