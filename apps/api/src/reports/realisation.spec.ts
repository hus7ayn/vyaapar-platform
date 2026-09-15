import {
  RealisationDoc,
  SettlementEvent,
  docMargin,
  realise,
  recogniseDoc,
  round2,
} from './realisation.util';

/**
 * Payment-based ("realised") profit: a bill earns profit when the customer pays for it.
 *
 * These tests drive the REAL engine — no DB, no Prisma, no mocks. They pin the two properties the
 * owner's money depends on:
 *   1. TELESCOPING — however many part-payments a bill is settled in, and in whatever order, the
 *      recognised profit sums to exactly the bill's margin. Not "close to". Exactly.
 *   2. NO REGRESSION — a shop that takes cash at the counter sees the same figures it sees today.
 *      Realised accounting must cost the owner nothing unless he actually sells on credit.
 */

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
const endOf = (d: string) => new Date(`${d}T23:59:59.999Z`);

type DocInput = {
  id: string;
  txnType?: 'SALE_INVOICE' | 'CREDIT_NOTE';
  date: string;
  total: number;
  tax?: number;
  cost: number;
  partyKey?: string;
  events?: SettlementEvent[];
};

/** One document. `cost` is the whole bill's cost of goods, as a single line. */
const doc = (d: DocInput): RealisationDoc => ({
  id: d.id,
  txnType: d.txnType ?? 'SALE_INVOICE',
  date: day(d.date),
  total: d.total,
  taxAmount: d.tax ?? 0,
  partyKey: d.partyKey ?? null,
  lines: [{ costPrice: d.cost, quantity: 1 }],
  events: d.events ?? [],
});

/** A counter tender: paid in full, over the counter, on the bill's own date. */
const paidInFull = (d: DocInput): RealisationDoc =>
  doc({ ...d, events: [{ amount: d.total, date: day(d.date), source: 'TENDER' }] });

const receipt = (amount: number, date: string, extra: Partial<SettlementEvent> = {}): SettlementEvent => ({
  amount,
  date: day(date),
  source: 'ALLOCATION',
  ...extra,
});

/**
 * The ACCRUAL Profit & Loss, exactly as reports.service.profitAndLoss computes it (after the two
 * bug fixes): net sales, less output tax NET of returns, less COGS with returns reversed at the
 * original sale's cost. This is the yardstick the cash-only shop must match to the paisa.
 */
function accrualGrossProfit(docs: RealisationDoc[]): number {
  let grossSales = 0, saleReturns = 0, outputTax = 0, returnTax = 0, saleCost = 0, returnCost = 0;
  for (const d of docs) {
    const cost = d.lines.reduce((s, l) => s + l.costPrice * l.quantity, 0);
    if (d.txnType === 'CREDIT_NOTE') {
      saleReturns += d.total; returnTax += d.taxAmount; returnCost += cost;
    } else {
      grossSales += d.total; outputTax += d.taxAmount; saleCost += cost;
    }
  }
  const netSales = grossSales - saleReturns;
  const netOutputTax = outputTax - returnTax;
  const cogs = saleCost - returnCost;
  return round2(netSales - netOutputTax - cogs);
}

describe('realised profit — the formula', () => {
  it('margin(I) = (total − tax) − Σ(cost × qty)', () => {
    const m = docMargin({
      txnType: 'SALE_INVOICE',
      total: 1180,
      taxAmount: 180,
      lines: [{ costPrice: 400, quantity: 1 }, { costPrice: 75, quantity: 4 }],
    });
    expect(m.revenue).toBe(1000);
    expect(m.cogs).toBe(700);
    expect(m.margin).toBe(300);
  });

  it('an UNPAID credit sale realises nothing — the bug the owner saw live', () => {
    // total 150, paid 0, balance 150, status OPEN. Accrual moved gross profit 1505 → 1555.
    const credit = doc({ id: 'I1', date: '2026-09-10', total: 150, cost: 100, partyKey: 'P1' });
    const out = realise({ docs: [credit], from: day('2026-09-01'), to: endOf('2026-09-30') });

    expect(docMargin(credit).margin).toBe(50);        // accrual still says 50
    expect(out.realisedGrossProfit).toBe(0);          // realised says nothing yet
    expect(out.creditSalesOutstanding).toBe(150);
    expect(out.unrealisedProfitOnCredit).toBe(50);    // "profit not yet received"
  });

  it('a 40%-paid bill yields exactly 40% of the margin', () => {
    const inv = doc({
      id: 'I1', date: '2026-04-02', total: 500, cost: 300, partyKey: 'P1',
      events: [receipt(200, '2026-04-20')],
    });
    const out = realise({ docs: [inv], from: day('2026-04-01'), to: endOf('2026-04-30') });
    expect(docMargin(inv).margin).toBe(200);
    expect(out.realisedGrossProfit).toBe(80);         // 0.4 × 200
    expect(out.realisedRevenue).toBe(200);            // 0.4 × 500
    expect(out.realisedCogs).toBe(120);               // 0.4 × 300
    expect(out.unrealisedProfitOnCredit).toBe(120);   // the other 60%
    expect(out.creditSalesOutstanding).toBe(300);
  });
});

describe('realised profit — it telescopes', () => {
  // A deliberately awkward bill: nothing here divides evenly.
  const TOTAL = 1000.03;
  const TAX = 152.55;
  const COST = 611.11;
  const MARGIN = round2(TOTAL - TAX - COST); // 236.37

  const run = (events: SettlementEvent[]) =>
    realise({
      docs: [doc({ id: 'I1', date: '2026-02-01', total: TOTAL, tax: TAX, cost: COST, partyKey: 'P1', events })],
      from: day('2026-02-01'),
      to: endOf('2026-02-28'),
    });

  it('ten part-payments sum to the same margin as one full receipt, to the paisa', () => {
    const one = run([receipt(TOTAL, '2026-02-05')]);
    const parts: SettlementEvent[] = [];
    for (let i = 0; i < 9; i++) parts.push(receipt(100, `2026-02-${String(i + 2).padStart(2, '0')}`));
    parts.push(receipt(round2(TOTAL - 900), '2026-02-20'));
    expect(round2(parts.reduce((s, e) => s + e.amount, 0))).toBe(TOTAL);

    const ten = run(parts);
    expect(one.realisedGrossProfit).toBe(MARGIN);
    expect(ten.realisedGrossProfit).toBe(MARGIN);
    expect(ten.realisedRevenue).toBe(one.realisedRevenue);
    expect(ten.realisedCogs).toBe(one.realisedCogs);
  });

  it('a hundred ragged part-payments still land exactly on the margin', () => {
    const parts: SettlementEvent[] = [];
    let left = TOTAL;
    for (let i = 0; i < 99; i++) {
      const amt = round2(TOTAL / 99 + (i % 7) * 0.01 - 0.03);
      parts.push(receipt(amt, '2026-02-10'));
      left = round2(left - amt);
    }
    parts.push(receipt(left, '2026-02-11'));
    expect(round2(parts.reduce((s, e) => s + e.amount, 0))).toBe(TOTAL);
    expect(run(parts).realisedGrossProfit).toBe(MARGIN);
  });

  it('the order of the receipts cannot change the total', () => {
    const parts = [receipt(400, '2026-02-03'), receipt(0.03, '2026-02-09'), receipt(600, '2026-02-17')];
    const forwards = run(parts).realisedGrossProfit;
    const backwards = run([...parts].reverse()).realisedGrossProfit;
    expect(forwards).toBe(MARGIN);
    expect(backwards).toBe(MARGIN);
  });

  it('each period gets its own slice, and the slices add up', () => {
    const events = [receipt(250, '2026-02-04'), receipt(250, '2026-03-04'), receipt(round2(TOTAL - 500), '2026-04-04')];
    const build = () => [doc({ id: 'I1', date: '2026-02-01', total: TOTAL, tax: TAX, cost: COST, partyKey: 'P1', events })];
    const feb = realise({ docs: build(), from: day('2026-02-01'), to: endOf('2026-02-28') }).realisedGrossProfit;
    const mar = realise({ docs: build(), from: day('2026-03-01'), to: endOf('2026-03-31') }).realisedGrossProfit;
    const apr = realise({ docs: build(), from: day('2026-04-01'), to: endOf('2026-04-30') }).realisedGrossProfit;
    expect(round2(feb + mar + apr)).toBe(MARGIN);
    expect(feb).toBeGreaterThan(0);
    expect(mar).toBeGreaterThan(0);
  });
});

describe('realised profit — credit notes reverse pro rata at the refund’s own date', () => {
  // Sold in January for cash; half of it comes back in February, refunded at the counter.
  const invoice = paidInFull({ id: 'I1', date: '2026-01-10', total: 1180, tax: 180, cost: 600, partyKey: 'P1' });
  const note = paidInFull({ id: 'C1', txnType: 'CREDIT_NOTE', date: '2026-02-05', total: 590, tax: 90, cost: 300, partyKey: 'P1' });

  it('January keeps the whole margin; February carries the reversal', () => {
    const jan = realise({ docs: [invoice, note], from: day('2026-01-01'), to: endOf('2026-01-31') });
    const feb = realise({ docs: [invoice, note], from: day('2026-02-01'), to: endOf('2026-02-28') });
    expect(jan.realisedGrossProfit).toBe(400);   // (1180 − 180) − 600
    expect(feb.realisedGrossProfit).toBe(-200);  // half the goods back: −((590 − 90) − 300)
    expect(round2(jan.realisedGrossProfit + feb.realisedGrossProfit)).toBe(200);
  });

  it('a refund that has NOT been paid back yet reverses nothing', () => {
    // The customer returned the goods but is carrying the credit, not holding cash.
    const unpaidNote = doc({ id: 'C1', txnType: 'CREDIT_NOTE', date: '2026-02-05', total: 590, tax: 90, cost: 300, partyKey: 'P1' });
    const feb = realise({ docs: [invoice, unpaidNote], from: day('2026-02-01'), to: endOf('2026-02-28') });
    expect(feb.realisedGrossProfit).toBe(0);
  });

  it('a return against a credit sale that was never paid cannot invent a loss', () => {
    // The trap: accrual would book +50 on the sale and −50 on the return. On a cash basis neither
    // happened, so realised profit must be exactly zero — not a phantom −50.
    const unpaidSale = doc({ id: 'I2', date: '2026-03-01', total: 150, cost: 100, partyKey: 'P9' });
    const unpaidNote = doc({ id: 'C2', txnType: 'CREDIT_NOTE', date: '2026-03-08', total: 150, cost: 100, partyKey: 'P9' });
    const out = realise({ docs: [unpaidSale, unpaidNote], from: day('2026-03-01'), to: endOf('2026-03-31') });
    expect(out.realisedGrossProfit).toBe(0);
  });

  it('a part-refunded credit note reverses only the part that was paid out', () => {
    const halfPaidNote = doc({
      id: 'C1', txnType: 'CREDIT_NOTE', date: '2026-02-05', total: 590, tax: 90, cost: 300, partyKey: 'P1',
      events: [{ amount: 295, date: day('2026-02-05'), source: 'TENDER' }],
    });
    const feb = realise({ docs: [invoice, halfPaidNote], from: day('2026-02-01'), to: endOf('2026-02-28') });
    expect(feb.realisedGrossProfit).toBe(-100); // half of the note's 200 margin
  });
});

describe('realised profit — a settlement discount is a write-off, never profit', () => {
  it('recognises the cash only, and charges the written-off amount against margin', () => {
    // applyAllocations folds discountAmount into paidAmount, so the bill closes — but only ₹900
    // of money ever arrived.
    const inv = doc({
      id: 'I1', date: '2026-05-02', total: 1000, cost: 800, partyKey: 'P1',
      events: [receipt(900, '2026-05-20', { writeOff: 100 })],
    });
    const out = realise({ docs: [inv], from: day('2026-05-01'), to: endOf('2026-05-31') });

    expect(docMargin(inv).margin).toBe(200);
    expect(out.realisedRevenue).toBe(900);            // 0.9 × 1000
    expect(out.realisedCogs).toBe(720);               // 0.9 × 800
    expect(out.settlementDiscounts).toBe(100);
    expect(out.realisedGrossProfit).toBe(80);         // 180 of margin, less the 100 written off
    expect(out.realisedCash).toBe(900);               // the write-off is NOT cash
    expect(out.creditSalesOutstanding).toBe(0);       // the bill is settled all the same
    expect(out.unrealisedProfitOnCredit).toBe(0);     // nothing more is coming
  });
});

describe('realised profit — receipts that name no bill are not allowed to vanish', () => {
  // createPaymentIn with autoAllocate:false and no allocations moves the party balance but
  // writes NO BillWiseAllocation row, so the bill still shows its full balance.
  const older = doc({ id: 'I1', date: '2026-06-01', total: 400, cost: 300, partyKey: 'P1' });
  const newer = doc({ id: 'I2', date: '2026-06-10', total: 600, cost: 400, partyKey: 'P1' });

  it('matches them FIFO against that party’s open bills, oldest first', () => {
    const out = realise({
      docs: [older, newer],
      unallocatedReceipts: [{ partyKey: 'P1', amount: 700, date: day('2026-06-20') }],
      from: day('2026-06-01'),
      to: endOf('2026-06-30'),
    });
    // 400 clears the older bill (margin 100), 300 covers half the newer one (margin 200 × 0.5).
    expect(out.realisedGrossProfit).toBe(200);
    expect(out.unallocatedReceipts).toBe(700);
    expect(out.unallocatedReceiptsMatched).toBe(700);
    expect(out.unallocatedReceiptsUnmatched).toBe(0);
    expect(out.creditSalesOutstanding).toBe(300);
  });

  it('never hands a bill more than it can absorb, and reports what it could not place', () => {
    const out = realise({
      docs: [older, newer],
      unallocatedReceipts: [{ partyKey: 'P1', amount: 1500, date: day('2026-06-20') }],
      from: day('2026-06-01'),
      to: endOf('2026-06-30'),
    });
    expect(out.realisedGrossProfit).toBe(300);              // both bills in full, no more
    expect(out.unallocatedReceiptsMatched).toBe(1000);
    expect(out.unallocatedReceiptsUnmatched).toBe(500);     // visible, not silently dropped
  });

  it('does not double-count a bill that was already settled by a real allocation', () => {
    const settled = doc({
      id: 'I1', date: '2026-06-01', total: 400, cost: 300, partyKey: 'P1',
      events: [receipt(400, '2026-06-05')],
    });
    const out = realise({
      docs: [settled, newer],
      unallocatedReceipts: [{ partyKey: 'P1', amount: 400, date: day('2026-06-20') }],
      from: day('2026-06-01'),
      to: endOf('2026-06-30'),
    });
    // 100 from the settled bill, then the loose 400 goes to the only bill with room left.
    expect(out.realisedGrossProfit).toBe(round2(100 + (400 / 600) * 200));
    expect(out.unallocatedReceiptsMatched).toBe(400);
  });

  it('a receipt from a party with nothing open is surfaced, not swallowed', () => {
    const out = realise({
      docs: [],
      unallocatedReceipts: [{ partyKey: 'P-OPENING', amount: 5000, date: day('2026-06-20') }],
      from: day('2026-06-01'),
      to: endOf('2026-06-30'),
    });
    // Settling a party's OPENING BALANCE is not a receipt against a sale: no invoice, no goods,
    // no margin. It must never be recognised — and must never be hidden either.
    expect(out.realisedGrossProfit).toBe(0);
    expect(out.unallocatedReceiptsUnmatched).toBe(5000);
  });
});

describe('realised profit — a CASH-ONLY shop sees no change at all', () => {
  /**
   * THE KEY NO-REGRESSION PROOF. Every document is settled in full on its own date, which is what
   * a counter sale is. Realised profit must then equal the accrual profit the owner already
   * knows, to the paisa — including tax, a fully comped bill and returns.
   */
  const shop: RealisationDoc[] = [
    paidInFull({ id: 'S1', date: '2026-07-01', total: 1180, tax: 180, cost: 640 }),
    paidInFull({ id: 'S2', date: '2026-07-03', total: 99.99, tax: 4.76, cost: 51.5 }),
    paidInFull({ id: 'S3', date: '2026-07-11', total: 2450.75, tax: 373.85, cost: 1611.11 }),
    paidInFull({ id: 'S4', date: '2026-07-19', total: 7, tax: 0, cost: 3.33 }),
    // A 100% bill discount: nothing can ever be collected on it, but the stock still left.
    doc({ id: 'S5', date: '2026-07-21', total: 0, tax: 0, cost: 120 }),
    // Returns, refunded at the counter the same day.
    paidInFull({ id: 'R1', txnType: 'CREDIT_NOTE', date: '2026-07-22', total: 118, tax: 18, cost: 60 }),
    paidInFull({ id: 'R2', txnType: 'CREDIT_NOTE', date: '2026-07-28', total: 1225.38, tax: 186.93, cost: 805.56 }),
  ];

  it('realised gross profit is byte-identical to accrual gross profit', () => {
    const out = realise({ docs: shop, from: day('2026-07-01'), to: endOf('2026-07-31') });
    expect(out.realisedGrossProfit).toBe(accrualGrossProfit(shop));
  });

  it('and so are realised revenue and realised COGS, line for line', () => {
    const out = realise({ docs: shop, from: day('2026-07-01'), to: endOf('2026-07-31') });
    const sign = (d: RealisationDoc) => (d.txnType === 'CREDIT_NOTE' ? -1 : 1);
    const revenue = round2(shop.reduce((s, d) => s + sign(d) * (d.total - d.taxAmount), 0));
    const cogs = round2(shop.reduce((s, d) => s + sign(d) * d.lines.reduce((c, l) => c + l.costPrice * l.quantity, 0), 0));
    expect(out.realisedRevenue).toBe(revenue);
    expect(out.realisedCogs).toBe(cogs);
    expect(out.settlementDiscounts).toBe(0);
  });

  it('nothing is left hanging: no outstanding credit, no unrealised profit', () => {
    const out = realise({ docs: shop, from: day('2026-07-01'), to: endOf('2026-07-31') });
    expect(out.creditSalesOutstanding).toBe(0);
    expect(out.unrealisedProfitOnCredit).toBe(0);
    expect(out.realisedOnPeriodSales).toBe(out.periodSalesProfit);
  });

  it('a fully comped bill books its cost at once instead of stranding it for ever', () => {
    const comped = doc({ id: 'S5', date: '2026-07-21', total: 0, cost: 120 });
    const out = realise({ docs: [comped], from: day('2026-07-01'), to: endOf('2026-07-31') });
    expect(out.realisedGrossProfit).toBe(-120);   // no divide-by-zero, no silent skip
    expect(out.creditSalesOutstanding).toBe(0);
  });
});

describe('realised profit — cheques and reporting detail', () => {
  it('a cheque IS realised, and is reported separately so it can be watched', () => {
    const inv = doc({
      id: 'I1', date: '2026-08-02', total: 1000, cost: 700, partyKey: 'P1',
      events: [receipt(600, '2026-08-09', { cheque: true }), receipt(400, '2026-08-15')],
    });
    const out = realise({ docs: [inv], from: day('2026-08-01'), to: endOf('2026-08-31') });
    expect(out.realisedGrossProfit).toBe(300);
    expect(out.realisedCash).toBe(1000);
    expect(out.realisedOnCheques).toBe(600);
  });

  it('per-document detail drives the bill/item/party surfaces', () => {
    const inv = doc({
      id: 'I1', date: '2026-08-02', total: 1000, cost: 700, partyKey: 'P1',
      events: [receipt(250, '2026-08-09')],
    });
    const r = recogniseDoc(inv, { to: endOf('2026-08-31').getTime() });
    expect(r.collectedFraction).toBe(0.25);
    expect(r.collectedMargin).toBe(75);
    expect(r.outstanding).toBe(750);
    expect(r.outstandingMargin).toBe(225);
    expect(round2(r.collectedMargin + r.outstandingMargin)).toBe(r.margin);
  });

  it('an over-allocation cannot manufacture margin the bill does not contain', () => {
    const inv = doc({
      id: 'I1', date: '2026-08-02', total: 1000, cost: 700, partyKey: 'P1',
      events: [receipt(900, '2026-08-09'), receipt(400, '2026-08-19')],
    });
    const out = realise({ docs: [inv], from: day('2026-08-01'), to: endOf('2026-08-31') });
    expect(out.realisedGrossProfit).toBe(300); // capped at the whole margin, not 390
  });

  it('money arriving after the period end is not counted early', () => {
    const inv = doc({
      id: 'I1', date: '2026-08-02', total: 1000, cost: 700, partyKey: 'P1',
      events: [receipt(1000, '2026-09-09')],
    });
    const aug = realise({ docs: [inv], from: day('2026-08-01'), to: endOf('2026-08-31') });
    expect(aug.realisedGrossProfit).toBe(0);
    expect(aug.creditSalesOutstanding).toBe(1000);
    expect(aug.unrealisedProfitOnCredit).toBe(300);
  });
});

describe('the two pre-existing Profit & Loss bugs (accrual side)', () => {
  /**
   * These mirror reports.service.accrualPnl before and after the fix, so the impact on historical
   * figures is written down rather than guessed at.
   *
   *   BUG 1 — the CREDIT_NOTE aggregate summed only `total`, so the output-tax figure was gross:
   *           the tax on a return was subtracted once inside the returned total and again as
   *           output tax.
   *   BUG 2 — a credit-note line stamps the item's CURRENT cost, so reversing COGS at that cost
   *           left a residual whenever the item's cost moved between the sale and the return.
   */
  const before = (x: {
    grossSales: number; saleReturns: number; outputTax: number;
    saleCost: number; returnCostAtReturnTime: number;
  }) => round2((x.grossSales - x.saleReturns) - x.outputTax - (x.saleCost - x.returnCostAtReturnTime));

  const after = (x: {
    grossSales: number; saleReturns: number; outputTax: number; returnTax: number;
    saleCost: number; returnCostAtSaleTime: number;
  }) => round2((x.grossSales - x.saleReturns) - (x.outputTax - x.returnTax) - (x.saleCost - x.returnCostAtSaleTime));

  it('a full return of a ₹118 bill used to report −18 instead of 0', () => {
    const shape = { grossSales: 118, saleReturns: 118, outputTax: 18, returnTax: 18, saleCost: 60 };
    expect(before({ ...shape, returnCostAtReturnTime: 60 })).toBe(-18);
    expect(after({ ...shape, returnCostAtSaleTime: 60 })).toBe(0);
  });

  it('a cost change between sale and return left a phantom COGS residual too', () => {
    // Sold when the item cost 60; by the time it came back the item cost 50.
    const shape = { grossSales: 118, saleReturns: 118, outputTax: 18, returnTax: 18, saleCost: 60 };
    expect(before({ ...shape, returnCostAtReturnTime: 50 })).toBe(-28); // −18 tax, −10 cost drift
    expect(after({ ...shape, returnCostAtSaleTime: 60 })).toBe(0);
  });

  it('a period with no returns is completely unaffected by either fix', () => {
    const shape = { grossSales: 11800, saleReturns: 0, outputTax: 1800, returnTax: 0, saleCost: 6400 };
    expect(before({ ...shape, returnCostAtReturnTime: 0 })).toBe(3600);
    expect(after({ ...shape, returnCostAtSaleTime: 0 })).toBe(3600);
  });

  it('the whole correction is exactly the returned tax plus the cost drift', () => {
    const shape = { grossSales: 50000, saleReturns: 4720, outputTax: 7627.12, returnTax: 720, saleCost: 28000 };
    const old = before({ ...shape, returnCostAtReturnTime: 2200 });
    const now = after({ ...shape, returnCostAtSaleTime: 2450 });
    expect(round2(now - old)).toBe(round2(720 + (2450 - 2200)));
  });
});
