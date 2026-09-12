import { Prisma } from '@prisma/client';
import { SaleService } from './sale.service';
import { TxnCoreService } from '../txns/txn-core.service';

/**
 * The money rule for returns: whatever the cashier is shown MUST equal what the server stores,
 * to the paisa, and repeated partial returns must add up to exactly what the customer paid.
 *
 * These tests drive the REAL TxnCoreService.buildLines/computeTotals (the arithmetic that decides
 * a stored row) and the REAL SaleService return math. Only createTxn's surrounding plumbing is
 * stubbed — its money logic (recompute the total from the lines, reject a payment above it,
 * derive the status) is reproduced here against the same helpers.
 */
const D = (v: number | string | Prisma.Decimal) => new Prisma.Decimal(v);
const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

const core = new TxnCoreService({} as never, {} as never);
const sale = new SaleService(core, {} as never);
// The private canonical helpers — the same ones return-dialog.tsx reimplements verbatim.
const priv = sale as unknown as {
  lineValue(l: { total: Prisma.Decimal | number; quantity: Prisma.Decimal | number }, qty: number): number;
  goodsOf<T extends { id: string; total: Prisma.Decimal | number; quantity: Prisma.Decimal | number }>(
    lines: T[], qtyOf: (l: T) => number,
  ): number;
  paidShare(invoiceTotal: number, goodsTotal: number, goods: number): number;
};

type LineIn = {
  name: string; quantity: number; unitPrice: number; taxRate?: number;
  discountAmount?: number; discountPercent?: number;
};
type Row = {
  id: string; name: string; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal; taxRate: Prisma.Decimal;
  discountAmount: Prisma.Decimal; discountPercent: Prisma.Decimal | null; total: Prisma.Decimal; unit: string;
};

/** Build a stored invoice row exactly the way createTxn would. */
async function post(input: {
  lines: LineIn[]; discountPercent?: number; discountAmount?: number;
  additionalCharges?: { name: string; amount: number }[]; roundOffEnabled?: boolean;
}) {
  const { built, subtotal, taxTotal } = await core.buildLines('b', input.lines, 'sale');
  const { total } = core.computeTotals({ subtotal, taxTotal, ...input });
  expect(total.isNegative()).toBe(false); // createTxn: "Total cannot be negative"
  const lines: Row[] = built.map((l, i) => ({
    id: `L${i}`, name: String(l.name), unit: 'PCS',
    quantity: D(l.quantity as Prisma.Decimal), unitPrice: D(l.unitPrice as Prisma.Decimal),
    taxRate: D(l.taxRate as Prisma.Decimal), discountAmount: D(l.discountAmount as Prisma.Decimal).toDecimalPlaces(2),
    discountPercent: l.discountPercent != null ? D(l.discountPercent as Prisma.Decimal) : null,
    total: D(l.total as Prisma.Decimal).toDecimalPlaces(2), // numeric(14,2)
  }));
  return { lines, total: total.toDecimalPlaces(2) };
}

/** The canonical value of a return — identical on the server and in the POS dialog. */
function valueOf(inv: { lines: Row[]; total: Prisma.Decimal }, already: Record<string, number>, now: Record<string, number>) {
  const T = Number(inv.total);
  const G = priv.goodsOf(inv.lines, (l) => Number(l.quantity));
  const before = priv.paidShare(T, G, priv.goodsOf(inv.lines, (l) => already[l.id] ?? 0));
  const after = priv.paidShare(T, G, priv.goodsOf(inv.lines, (l) => (already[l.id] ?? 0) + (now[l.id] ?? 0)));
  return Math.max(0, round2(after - before));
}

/** Raise the credit note for `now` and return what the till actually pays out. */
async function refund(inv: { lines: Row[]; total: Prisma.Decimal }, already: Record<string, number>, now: Record<string, number>) {
  const byId = new Map(inv.lines.map((l) => [l.id, l]));
  const built = [];
  for (const [lineId, qty] of Object.entries(now)) {
    const orig = byId.get(lineId)!;
    const qtyD = D(round3(qty));
    const grossD = orig.unitPrice.mul(qtyD);
    const prorataD = orig.discountPercent != null
      ? grossD.mul(orig.discountPercent).div(100)
      : orig.discountAmount.mul(qtyD).div(orig.quantity);
    const taxableD = grossD.sub(prorataD).toDecimalPlaces(2);
    built.push({
      name: orig.name, quantity: qtyD.toNumber(), unit: orig.unit,
      unitPrice: orig.unitPrice.toNumber(), taxRate: orig.taxRate.toNumber(),
      discountAmount: grossD.sub(taxableD).toNumber(),
    });
  }
  const value = valueOf(inv, already, now);

  // Mirror of postReturn's adjust, then of createTxn's own recompute of the same lines.
  const { subtotal, taxTotal } = await core.buildLines('b', built, 'sale');
  const adjust = D(value).sub(subtotal.add(taxTotal));
  const { total } = core.computeTotals({
    subtotal, taxTotal, roundOffEnabled: false,
    ...(adjust.lt(0) ? { discountAmount: adjust.neg().toNumber() } : {}),
    ...(adjust.gt(0) ? { additionalCharges: [{ name: 'Charges & round-off', amount: adjust.toNumber() }] } : {}),
  });
  const paid = D(value);
  expect(total.isNegative()).toBe(false);            // createTxn: "Total cannot be negative"
  expect(paid.gt(total)).toBe(false);                // createTxn: "Paid amount exceeds total"
  expect(total.sub(paid).toNumber()).toBe(0);        // status PAID, no residual party-ledger debt
  expect(total.toNumber()).toBe(value);              // the popup figure IS the booked figure
  return value;
}

/** Return the whole bill in the given batches; the payouts must sum to invoice.total exactly. */
async function returnInBatches(
  inv: { lines: Row[]; total: Prisma.Decimal },
  batches: Record<string, number>[],
) {
  const already: Record<string, number> = {};
  const paid: number[] = [];
  for (const now of batches) {
    paid.push(await refund(inv, already, now));
    for (const [id, q] of Object.entries(now)) already[id] = round3((already[id] ?? 0) + q);
  }
  for (const l of inv.lines) expect(round3(already[l.id] ?? 0)).toBe(Number(l.quantity));
  return { paid, sum: round2(paid.reduce((s, v) => s + v, 0)) };
}

describe('sale return math — the canonical value of a return', () => {
  it('a whole line is worth its stored total, with no division', () => {
    const l = { total: D('295.00'), quantity: D(3) };
    expect(priv.lineValue(l, 3)).toBe(295);
    expect(priv.lineValue(l, 1)).toBeCloseTo(98.3333333, 6);
    expect(priv.lineValue(l, 0)).toBe(0);
    expect(priv.lineValue({ total: D(10), quantity: D(0) }, 1)).toBe(0); // no divide-by-zero
  });

  it('round-off UP + mixed tax rates + percentage bill discount refunds exactly what was paid', async () => {
    // The audit case: the dialog quoted ₹505.00 while the server booked ₹454.50.
    const inv = await post({
      lines: [{ name: 'A', quantity: 2, unitPrice: 100, taxRate: 5 }, { name: 'B', quantity: 1, unitPrice: 250, taxRate: 18 }],
      discountPercent: 10, roundOffEnabled: true,
    });
    expect(inv.total.toNumber()).toBe(455);
    const { sum } = await returnInBatches(inv, [{ L0: 2, L1: 1 }]);
    expect(sum).toBe(455);
  });

  it('round-off DOWN never pays out more than was collected, in one call or in three', async () => {
    // The audit case: one call paid ₹971.23 and three calls ₹971.22 on a ₹971 bill.
    const mk = () => post({ lines: [{ name: 'A', quantity: 3, unitPrice: 333.33, taxRate: 5 }], discountPercent: 7.5, roundOffEnabled: true });
    const one = await mk();
    expect(one.total.toNumber()).toBe(971);
    expect((await returnInBatches(one, [{ L0: 3 }])).sum).toBe(971);
    const three = await mk();
    const split = await returnInBatches(three, [{ L0: 1 }, { L0: 1 }, { L0: 1 }]);
    expect(split.sum).toBe(971);
    expect(split.paid).toEqual([323.67, 323.66, 323.67]);
  });

  it('additional charges are refunded, pro rata, on the explicit-selection path', async () => {
    // The audit case: a ₹50 charge was never refunded, yet the invoice was stamped REFUNDED.
    const inv = await post({
      lines: [{ name: 'A', quantity: 2, unitPrice: 100, taxRate: 5 }],
      additionalCharges: [{ name: 'Delivery', amount: 50 }], roundOffEnabled: true,
    });
    expect(inv.total.toNumber()).toBe(260);
    const { paid, sum } = await returnInBatches(inv, [{ L0: 1 }, { L0: 1 }]);
    expect(paid).toEqual([130, 130]);
    expect(sum).toBe(260);
  });

  it('a flat bill discount larger than the goods still refunds what was paid', async () => {
    const inv = await post({
      lines: [{ name: 'A', quantity: 1, unitPrice: 100, taxRate: 0 }],
      discountAmount: 130, additionalCharges: [{ name: 'Delivery', amount: 50 }], roundOffEnabled: true,
    });
    expect(inv.total.toNumber()).toBe(20);
    expect((await returnInBatches(inv, [{ L0: 1 }])).sum).toBe(20); // was ₹0.00
  });

  it('a 100% bill discount can be returned at all (it used to throw for ever)', async () => {
    const inv = await post({ lines: [{ name: 'A', quantity: 1, unitPrice: 99.99, taxRate: 5 }], discountPercent: 100, roundOffEnabled: true });
    expect(inv.total.toNumber()).toBe(0);
    expect((await returnInBatches(inv, [{ L0: 1 }])).sum).toBe(0);
  });

  it('an invoice that rounded UP can be fully returned (no "Paid amount exceeds total")', async () => {
    const inv = await post({ lines: [{ name: 'A', quantity: 1, unitPrice: 95, taxRate: 5 }], roundOffEnabled: true });
    expect(inv.total.toNumber()).toBe(100); // raw 99.75
    expect((await returnInBatches(inv, [{ L0: 1 }])).sum).toBe(100);
  });

  it('twelve unit-by-unit returns sum to the bill, with no PARTIAL credit notes', async () => {
    // The audit case: ₹1,259.76 paid back on a ₹1,260 bill, twelve notes stuck at PARTIAL.
    const inv = await post({ lines: [{ name: 'A', quantity: 12, unitPrice: 99.99, taxRate: 5 }], roundOffEnabled: true });
    expect(inv.total.toNumber()).toBe(1260);
    expect((await returnInBatches(inv, Array.from({ length: 12 }, () => ({ L0: 1 })))).sum).toBe(1260);
  });

  it('line discounts (flat and %), mixed rates, charges and round-off all balance across 4 batches', async () => {
    const inv = await post({
      lines: [
        { name: 'A', quantity: 5, unitPrice: 249.5, taxRate: 12, discountAmount: 37.5 },
        { name: 'B', quantity: 3, unitPrice: 1099, taxRate: 18, discountPercent: 7.25 },
        { name: 'C', quantity: 2, unitPrice: 19.99, taxRate: 0 },
      ],
      discountAmount: 250, additionalCharges: [{ name: 'Packing', amount: 35.5 }], roundOffEnabled: true,
    });
    const { sum } = await returnInBatches(inv, [{ L0: 2 }, { L1: 1, L2: 1 }, { L0: 3, L1: 1 }, { L1: 1, L2: 1 }]);
    expect(sum).toBe(inv.total.toNumber());
  });
});
