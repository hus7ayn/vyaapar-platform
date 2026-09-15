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
const floor2 = (n: number) => Math.floor(n * 100) / 100;

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
  // Test-only: which catalogue item this line sold. Stripped before buildLines (the stubbed
  // prisma cannot look an item up) and pinned back onto the stored row, which is all the
  // exchange allowance pool actually reads.
  itemId?: string;
};
type Row = {
  id: string; itemId: string | null;
  name: string; quantity: Prisma.Decimal; unitPrice: Prisma.Decimal; taxRate: Prisma.Decimal;
  discountAmount: Prisma.Decimal; discountPercent: Prisma.Decimal | null; total: Prisma.Decimal; unit: string;
};

/** Build a stored invoice row exactly the way createTxn would. */
async function post(input: {
  lines: LineIn[]; discountPercent?: number; discountAmount?: number;
  additionalCharges?: { name: string; amount: number }[]; roundOffEnabled?: boolean;
}) {
  const { built, subtotal, taxTotal } = await core.buildLines('b', input.lines.map(({ itemId: _drop, ...l }) => l), 'sale');
  const { total } = core.computeTotals({ subtotal, taxTotal, ...input });
  expect(total.isNegative()).toBe(false); // createTxn: "Total cannot be negative"
  const lines: Row[] = built.map((l, i) => ({
    id: `L${i}`, itemId: input.lines[i].itemId ?? null, name: String(l.name), unit: 'PCS',
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

// ── Exchange: the replacement leg ─────────────────────────────────────────────────────────────

type CatalogItem = { id: string; name: string; salePrice: number; taxRate: number };
type Replacement = { itemId: string; quantity: number; discountAmount?: number };

/**
 * Ring up the replacement leg of an exchange TWICE over the same inputs: once the way
 * SaleService.exchangeInvoice builds and posts it (the real buildLines/computeTotals, over
 * Decimals), and once the way return-dialog.tsx quotes it on screen (plain floats). They must
 * land on the same paisa — that is the whole contract between the popup and the till.
 *
 * The cashier's discount reaches ONE place: the catalogue-priced remainder sub-line. Allowance
 * sub-lines re-issue a price already charged and are never touched, which is what keeps a
 * like-for-like swap netting exactly zero.
 */
async function exchange(
  inv: { lines: Row[]; total: Prisma.Decimal },
  already: Record<string, number>,
  now: Record<string, number>,
  replacements: Replacement[],
  catalog: CatalogItem[],
) {
  // Leg 1 fixes both of these BEFORE a single replacement is read, so nothing below can move them.
  const value = valueOf(inv, already, now);
  const returnedGoods = priv.goodsOf(inv.lines, (l) => now[l.id] ?? 0);
  const k = returnedGoods > 0 ? value / returnedGoods : 0;

  type Allowance = { qty: number; unitPrice: number; netUnitPrice: number; taxRate: number };
  const allowances = new Map<string, Allowance[]>();
  for (const orig of inv.lines) {
    const qty = round3(now[orig.id] ?? 0);
    const soldQty = Number(orig.quantity);
    if (!orig.itemId || qty <= 0 || !(soldQty > 0)) continue;
    const discountPerUnit = orig.discountPercent != null
      ? (Number(orig.unitPrice) * Number(orig.discountPercent)) / 100
      : Number(orig.discountAmount ?? 0) / soldQty;
    const list = allowances.get(orig.itemId) ?? [];
    list.push({
      qty, unitPrice: Number(orig.unitPrice), taxRate: Number(orig.taxRate),
      netUnitPrice: round2((Number(orig.unitPrice) - discountPerUnit) * k),
    });
    allowances.set(orig.itemId, list);
  }
  for (const list of allowances.values())
    list.sort((a, b) => b.netUnitPrice - a.netUnitPrice || b.taxRate - a.taxRate || b.unitPrice - a.unitPrice);

  const lines: LineIn[] = [];
  const allowanceLines: LineIn[] = [];   // the sub-lines that must stay untouched by any discount
  let quoteSub = 0;                      // the dialog's float running total
  let quoteTax = 0;
  let honoured = 0;                      // the discount actually applied, after the cap
  for (const r of replacements) {
    const item = catalog.find((c) => c.id === r.itemId)!;
    let left = round3(r.quantity);
    for (const a of allowances.get(r.itemId) ?? []) {
      if (left <= 0) break;
      const take = Math.min(left, a.qty);
      if (take <= 0) continue;
      a.qty = round3(a.qty - take);
      left = round3(left - take);
      const line: LineIn = {
        name: item.name, quantity: take, unitPrice: a.unitPrice, taxRate: a.taxRate,
        discountAmount: round2((a.unitPrice - a.netUnitPrice) * take),
      };
      lines.push(line);
      allowanceLines.push(line);
      const taxable = a.unitPrice * take - (line.discountAmount ?? 0);
      quoteSub += taxable;
      quoteTax += (taxable * a.taxRate) / 100;
    }
    if (left > 0) {
      const unitPrice = item.salePrice;
      // THE cap. Textually the same expression in sale.service.ts and in return-dialog.tsx; a cap
      // computed two different ways is the one thing that can break the paisa invariant.
      const discountAmount = Math.min(round2(r.discountAmount ?? 0), floor2(unitPrice * left));
      lines.push({ name: item.name, quantity: left, unitPrice, discountAmount, taxRate: item.taxRate });
      honoured = round2(honoured + discountAmount);
      const taxable = unitPrice * left - discountAmount;
      quoteSub += taxable;
      quoteTax += (taxable * item.taxRate) / 100;
    }
  }

  // What the till books: the REAL buildLines/computeTotals over the very lines posted above
  // (roundOffEnabled false, no bill-level discount or charges — exactly exchangeInvoice's call).
  const { subtotal, taxTotal } = await core.buildLines('b', lines, 'sale');
  const { total } = core.computeTotals({ subtotal, taxTotal, roundOffEnabled: false });
  expect(total.isNegative()).toBe(false);            // createTxn: "Total cannot be negative"
  expect(D(total.toNumber()).gt(total)).toBe(false); // createTxn: "Paid amount exceeds total"
  const saleTotal = total.toDecimalPlaces(2).toNumber(); // Txn.total is numeric(14,2)

  // THE invariant: the popup figure IS the booked figure, to the paisa.
  expect(round2(quoteSub + quoteTax)).toBe(saleTotal);

  return { value, saleTotal, honoured, allowanceLines, net: round2(saleTotal - value) };
}

describe('exchange replacement discount', () => {
  const TEE: CatalogItem = { id: 'I1', name: 'Tee', salePrice: 250, taxRate: 5 };
  const JACKET: CatalogItem = { id: 'I2', name: 'Jacket', salePrice: 800, taxRate: 0 };
  const COAT: CatalogItem = { id: 'I3', name: 'Coat', salePrice: 1000, taxRate: 18 };
  const ODD: CatalogItem = { id: 'I4', name: 'Odd', salePrice: 19.99, taxRate: 0 };
  const catalog = [TEE, JACKET, COAT, ODD];

  /** 2 × Tee @ ₹250 + 5% tax, 10% off the bill, round-off on. */
  const bill = () => post({
    lines: [{ name: 'Tee', itemId: 'I1', quantity: 2, unitPrice: 250, taxRate: 5 }],
    discountPercent: 10, roundOffEnabled: true,
  });

  it('a discount lowers the exchange sale by exactly the discount (untaxed) and never the refund', async () => {
    const inv = await bill();
    const plain = await exchange(inv, {}, { L0: 1 }, [{ itemId: 'I2', quantity: 1 }], catalog);
    const cut = await exchange(inv, {}, { L0: 1 }, [{ itemId: 'I2', quantity: 1, discountAmount: 50 }], catalog);

    expect(plain.saleTotal).toBe(800);                       // 1 × ₹800, 0% tax
    expect(cut.saleTotal).toBe(750);                         // exactly ₹50 less
    expect(round2(plain.saleTotal - cut.saleTotal)).toBe(50);
    // The refund leg is untouched — same credit note, same cash, before and after the discount.
    expect(cut.value).toBe(plain.value);
    expect(await refund(inv, {}, { L0: 1 })).toBe(plain.value);
    // ...and the difference the customer settles falls by exactly the discount.
    expect(round2(plain.net - cut.net)).toBe(50);
  });

  it('the discount is PRE-TAX, so a taxed replacement falls by discount × (1 + rate)', async () => {
    const inv = await bill();
    const plain = await exchange(inv, {}, { L0: 1 }, [{ itemId: 'I3', quantity: 1 }], catalog);
    const cut = await exchange(inv, {}, { L0: 1 }, [{ itemId: 'I3', quantity: 1, discountAmount: 100 }], catalog);

    expect(plain.saleTotal).toBe(1180);                      // 1000 + 18%
    expect(cut.saleTotal).toBe(1062);                        // (1000 − 100) + 18%
    expect(round2(plain.saleTotal - cut.saleTotal)).toBe(118); // = 100 × 1.18, the pre-tax basis
    expect(cut.value).toBe(plain.value);
  });

  it('a like-for-like swap still nets exactly zero — with no discount field, and with 0', async () => {
    const inv = await bill();
    for (const discountAmount of [undefined, 0]) {
      const x = await exchange(inv, {}, { L0: 1 }, [{ itemId: 'I1', quantity: 1, discountAmount }], catalog);
      expect(x.net).toBe(0);                                  // customer pays nothing, gets nothing back
      expect(x.honoured).toBe(0);
      expect(x.allowanceLines.length).toBe(1);
    }
  });

  it('a discount cannot reach an allowance sub-line: the swapped-back unit still nets zero', async () => {
    const inv = await bill();
    // 1 unit comes back and is re-issued as an allowance; 2 more Tees are an ordinary sale.
    const plain = await exchange(inv, {}, { L0: 1 }, [{ itemId: 'I1', quantity: 3 }], catalog);
    const cut = await exchange(inv, {}, { L0: 1 }, [{ itemId: 'I1', quantity: 3, discountAmount: 200 }], catalog);
    expect(plain.allowanceLines).toEqual(cut.allowanceLines); // byte-identical allowance lines
    expect(cut.honoured).toBe(200);
    expect(round2(plain.saleTotal - cut.saleTotal)).toBe(210); // 200 × 1.05 — only the new units
    expect(cut.value).toBe(plain.value);
  });

  it('the cap holds: an absurd discount zeroes the catalogue line and nothing more', async () => {
    const inv = await bill();
    // Allowance covers 1 Tee, the other 2 are sold at ₹250 → the most that can come off is ₹500.
    const capped = await exchange(inv, {}, { L0: 1 }, [{ itemId: 'I1', quantity: 3, discountAmount: 99999 }], catalog);
    const swapOnly = await exchange(inv, {}, { L0: 1 }, [{ itemId: 'I1', quantity: 1 }], catalog);
    expect(capped.honoured).toBe(500);                        // floor2(250 × 2)
    expect(capped.saleTotal).toBe(swapOnly.saleTotal);        // the 2 new Tees now cost nothing
    expect(capped.net).toBe(0);                               // and the swap still nets zero
  });

  it('the cap floors at the paisa, so a float tail can never push a line negative', async () => {
    const inv = await bill();
    // 19.99 × 7 is 139.92999999999998 in floats; the cap floors to ₹139.92, a paisa BELOW the
    // Decimal gross of ₹139.93 — conservative on both sides rather than negative on one.
    const x = await exchange(inv, {}, { L0: 1 }, [{ itemId: 'I4', quantity: 7, discountAmount: 500 }], catalog);
    expect(x.honoured).toBe(139.92);
    expect(x.saleTotal).toBe(0.01);
  });

  it('survives a float-hostile bill: two discounts, two tax rates, a part-allowance swap', async () => {
    // Line discounts (flat + %), mixed rates, a flat bill discount, a packing charge and round-off,
    // a partly-already-returned line, a swap that is part allowance and part catalogue, and two
    // discounts that do not sit on the paisa. The server's Decimal total is 985.1863; the dialog's
    // float running total is 985.1863000000001 — and both book ₹985.19.
    const inv = await post({
      lines: [
        { name: 'Tee', itemId: 'I1', quantity: 5, unitPrice: 249.5, taxRate: 12, discountAmount: 37.5 },
        { name: 'Cap', itemId: 'I5', quantity: 3, unitPrice: 1099, taxRate: 18, discountPercent: 7.25 },
      ],
      discountAmount: 250, additionalCharges: [{ name: 'Packing', amount: 35.5 }], roundOffEnabled: true,
    });
    expect(inv.total.toNumber()).toBe(4749);
    const cat = [...catalog, { id: 'I6', name: 'Mug', salePrice: 33.33, taxRate: 12 }];
    const already = { L0: 1 };
    const now = { L0: 2, L1: 1 };
    // 3 Tees (2 on allowance at the rate paid, 1 at today's ₹250 + 5%) and 7 Mugs at ₹33.33 + 12%.
    const want = [{ itemId: 'I1', quantity: 3 }, { itemId: 'I6', quantity: 7 }];
    const plain = await exchange(inv, already, now, want, cat);
    const cut = await exchange(inv, already, now, [
      { itemId: 'I1', quantity: 3, discountAmount: 41.37 },
      { itemId: 'I6', quantity: 7, discountAmount: 12.345 },
    ], cat);

    expect(plain.saleTotal).toBe(1042.46);
    expect(cut.saleTotal).toBe(985.19);
    expect(cut.honoured).toBe(53.72);                          // 41.37 + round2(12.345) = 12.35
    // Pre-tax discounts on a 5% line and a 12% line: 41.37 × 1.05 + 12.35 × 1.12 = 57.2705.
    expect(round2(plain.saleTotal - cut.saleTotal)).toBe(57.27);
    // The refund leg does not move, and neither do the allowance sub-lines it priced.
    expect(cut.value).toBe(plain.value);
    expect(cut.value).toBe(await refund(inv, already, now));
    expect(cut.allowanceLines).toEqual(plain.allowanceLines);
  });

  it('the exchange never disturbs the refund ledger: returns still telescope to the bill', async () => {
    const inv = await bill();
    // Unit 1 leaves as an exchange with a discounted replacement; unit 2 as a plain refund.
    const x = await exchange(inv, {}, { L0: 1 }, [{ itemId: 'I3', quantity: 1, discountAmount: 250 }], catalog);
    const second = await refund(inv, { L0: 1 }, { L0: 1 });
    expect(round2(x.value + second)).toBe(inv.total.toNumber());
  });
});
