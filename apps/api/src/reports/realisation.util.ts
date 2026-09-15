/**
 * Payment-based ("realised") profit — the arithmetic only.
 *
 * Pure: no Prisma, no I/O, no dates beyond epoch milliseconds. It takes plain documents (a sale
 * invoice or a credit note: total, tax, lines with a cost, and the cash events that settled it)
 * and returns realised revenue / COGS / margin for a period, plus what is still owed.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────────────────────────────
 * A bill earns profit when the customer pays for it, not when it is raised.
 *
 *   margin(I)  = (I.total − I.taxAmount) − Σ(line.costPrice × line.quantity)
 *   for a cash event of amount c against I, recognise   (c / I.total) × margin(I)
 *   in the period of THAT event.
 *
 * Because every receipt against a bill divides the same margin by the same denominator, the
 * receipts against a bill telescope: any number of part-payments, in any order, sum to exactly
 * margin(I) once the bill is fully paid — never a paisa more or less. The implementation
 * guarantees that even against floating point by rounding the CUMULATIVE recognised figure and
 * taking differences, so each step is the exact remainder of the steps before it.
 *
 * ── SIGNS ─────────────────────────────────────────────────────────────────────────────────────
 * A CREDIT_NOTE is the same shape with sign −1: its own total, its own tax, its own lines (valued
 * at the ORIGINAL sale's cost where the return is linked to one) and its own cash events — the
 * refund handed over the counter. So a refund reverses profit pro rata at the refund's own date,
 * and a return that has NOT been paid back yet reverses nothing. That also makes a cash-only
 * shop's realised figures identical to its accrual figures, because every document settles in
 * full on its own date.
 *
 * ── SETTLEMENT DISCOUNTS ──────────────────────────────────────────────────────────────────────
 * A bill-wise allocation can carry a discountAmount. The ledger folds it into paidAmount, but it
 * is a WRITE-OFF, not money: it closes the bill without any cash arriving. So it settles the bill
 * (the customer owes nothing more) but recognises no margin, and the written-off amount is
 * subtracted from realised margin as the cost of getting paid.
 *
 * ── CHEQUES ───────────────────────────────────────────────────────────────────────────────────
 * A cheque IS realised. The customer has settled; the ledger already treats the bill as paid and
 * the receivable as cleared, so excluding it would make realised profit disagree with the party
 * balance the owner is looking at. Cheques are tracked separately anyway (`realisedOnCheques`) so
 * the owner can see how much realised profit is still paper in the drawer rather than money in
 * the bank.
 */

export type DateLike = Date | string | number;

export const msOf = (d: DateLike): number => (d instanceof Date ? d.getTime() : new Date(d).getTime());

/** Round to the paisa, away from zero, immune to the usual 0.145 → 0.14 float traps. */
export const round2 = (n: number): number => {
  if (!Number.isFinite(n)) return 0;
  const r = Math.round(Math.abs(n) * 100 + 1e-9) / 100;
  return n < 0 ? -r : r;
};

export interface RealisationLine {
  /** The cost the goods were bought at — for a return, the ORIGINAL sale's cost. */
  costPrice: number;
  quantity: number;
}

export type SettlementSource = 'TENDER' | 'ALLOCATION' | 'UNALLOCATED';

export interface SettlementEvent {
  /** Cash that actually moved, in the document's own direction. Never negative in practice. */
  amount: number;
  /** A settlement discount written off with this event: settles the bill, but is not cash. */
  writeOff?: number;
  date: DateLike;
  source: SettlementSource;
  /** The money is a cheque — counted as realised, reported separately. */
  cheque?: boolean;
}

export interface RealisationDoc {
  id: string;
  txnType: 'SALE_INVOICE' | 'CREDIT_NOTE';
  date: DateLike;
  total: number;
  taxAmount: number;
  /** Party this document belongs to — the key unallocated receipts are matched on. */
  partyKey?: string | null;
  lines: RealisationLine[];
  events: SettlementEvent[];
}

/**
 * A PAYMENT_IN that moved the party balance but names no bill (createPaymentIn with
 * autoAllocate:false and no allocations). It is real money and must never vanish from realised
 * profit, so it is matched FIFO against that party's still-open bills at report time.
 */
export interface UnallocatedReceipt {
  partyKey: string;
  amount: number;
  date: DateLike;
  cheque?: boolean;
}

export interface DocRealisation {
  id: string;
  txnType: 'SALE_INVOICE' | 'CREDIT_NOTE';
  sign: 1 | -1;
  /** Whole-document accrual figures, signed. */
  revenue: number;
  cogs: number;
  margin: number;
  /** Share of the document paid for in cash, as of the end of the window (0…1). */
  collectedFraction: number;
  /** Share settled by any means — cash plus write-offs (0…1). */
  settledFraction: number;
  /** Recognised inside the window, signed. */
  periodRevenue: number;
  periodCogs: number;
  periodWriteOff: number;
  periodMargin: number;
  periodCash: number;
  periodChequeCash: number;
  /** Recognised from the start of time to the end of the window, signed. */
  collectedRevenue: number;
  collectedCogs: number;
  collectedMargin: number;
  /** Still owed at the end of the window, and the profit riding on it. */
  outstanding: number;
  outstandingMargin: number;
}

export interface RealisationWindow {
  /** Epoch ms, inclusive. Omit for "from the beginning". */
  from?: number;
  /** Epoch ms, inclusive. Omit for "up to now". */
  to?: number;
}

/** Accrual value of a document: revenue net of tax, cost of the goods on it, and the margin. */
export function docMargin(doc: Pick<RealisationDoc, 'txnType' | 'total' | 'taxAmount' | 'lines'>) {
  const sign: 1 | -1 = doc.txnType === 'CREDIT_NOTE' ? -1 : 1;
  const revenue = round2(doc.total - doc.taxAmount);
  const cogs = round2(doc.lines.reduce((s, l) => s + l.costPrice * l.quantity, 0));
  return { sign, revenue, cogs, margin: round2(revenue - cogs) };
}

/**
 * Walk a document's cash events in date order and split its margin across them.
 *
 * Every step recognises the difference between the cumulative rounded figure now and the
 * cumulative rounded figure before it, so N receipts always sum to exactly what one receipt of
 * the same total would have recognised.
 */
export function recogniseDoc(doc: RealisationDoc, window: RealisationWindow = {}): DocRealisation {
  const { sign, revenue, cogs, margin } = docMargin(doc);
  const from = window.from ?? Number.NEGATIVE_INFINITY;
  const to = window.to ?? Number.POSITIVE_INFINITY;
  const total = doc.total;

  const events = doc.events
    .map((e) => ({ ...e, at: msOf(e.date) }))
    .filter((e) => Number.isFinite(e.at) && e.at <= to)
    .sort((a, b) => a.at - b.at);

  // A fully comped bill (total 0) can never receive a paisa, so a cash rule would strand its
  // cost for ever. Nothing is owed on it either — it settles itself on its own date, which is
  // exactly where accrual books it. This is also the divide-by-zero guard.
  const docAt = msOf(doc.date);
  if (total === 0 && Number.isFinite(docAt) && docAt <= to) {
    events.unshift({ amount: 0, date: doc.date, source: 'TENDER', at: docAt });
  }

  let cash = 0;
  let settled = 0;
  let revCum = 0;
  let cogsCum = 0;
  let writeCum = 0;
  let pRev = 0;
  let pCogs = 0;
  let pWrite = 0;
  let pCash = 0;
  let pCheque = 0;

  for (const e of events) {
    const write = e.writeOff ?? 0;
    cash += e.amount;
    settled += e.amount + write;
    writeCum += write;
    // Cap at 1: an over-allocation (or a FIFO fallback that guessed the wrong bill) must never
    // manufacture margin that the document does not contain.
    const f = total === 0 ? 1 : Math.min(1, cash / total);
    const revNext = round2(f * revenue);
    const cogsNext = round2(f * cogs);
    const dRev = revNext - revCum;
    const dCogs = cogsNext - cogsCum;
    revCum = revNext;
    cogsCum = cogsNext;
    if (e.at >= from) {
      pRev += dRev;
      pCogs += dCogs;
      pWrite += write;
      pCash += e.amount;
      if (e.cheque) pCheque += e.amount;
    }
  }

  const collectedFraction = total === 0 ? 1 : Math.min(1, cash / total);
  const settledFraction = total === 0 ? 1 : Math.min(1, settled / total);
  const settledMargin = round2(settledFraction * margin);

  return {
    id: doc.id,
    txnType: doc.txnType,
    sign,
    revenue: sign * revenue,
    cogs: sign * cogs,
    margin: sign * margin,
    collectedFraction,
    settledFraction,
    periodRevenue: sign * round2(pRev),
    periodCogs: sign * round2(pCogs),
    periodWriteOff: sign * round2(pWrite),
    periodMargin: sign * round2(pRev - pCogs - pWrite),
    periodCash: sign * round2(pCash),
    periodChequeCash: sign * round2(pCheque),
    collectedRevenue: sign * revCum,
    collectedCogs: sign * cogsCum,
    collectedMargin: sign * round2(revCum - cogsCum - writeCum),
    outstanding: Math.max(0, round2(total - settled)),
    outstandingMargin: sign * round2(margin - settledMargin),
  };
}

export interface FifoBill {
  id: string;
  partyKey: string;
  date: DateLike;
  /** How much this bill can still absorb, after every recorded settlement. */
  capacity: number;
}

/**
 * Spread unallocated receipts FIFO (oldest bill first) over a party's still-open bills.
 * Never hands a bill more than it can absorb, so nothing is double-counted; whatever cannot be
 * matched is reported as `unmatched` rather than silently dropped.
 */
export function spreadUnallocated(
  receipts: UnallocatedReceipt[],
  bills: FifoBill[],
): { events: Map<string, SettlementEvent[]>; applied: number; unmatched: number } {
  const byParty = new Map<string, { id: string; at: number; left: number }[]>();
  for (const b of bills) {
    if (b.capacity <= 0) continue;
    const list = byParty.get(b.partyKey) ?? [];
    list.push({ id: b.id, at: msOf(b.date), left: b.capacity });
    byParty.set(b.partyKey, list);
  }
  for (const list of byParty.values()) list.sort((a, b) => a.at - b.at);

  const events = new Map<string, SettlementEvent[]>();
  let applied = 0;
  let unmatched = 0;

  for (const r of [...receipts].sort((a, b) => msOf(a.date) - msOf(b.date))) {
    let left = round2(r.amount);
    const open = byParty.get(r.partyKey) ?? [];
    for (const bill of open) {
      if (left <= 0) break;
      if (bill.left <= 0) continue;
      const take = round2(Math.min(left, bill.left));
      if (take <= 0) continue;
      bill.left = round2(bill.left - take);
      left = round2(left - take);
      applied = round2(applied + take);
      const list = events.get(bill.id) ?? [];
      list.push({ amount: take, date: r.date, source: 'UNALLOCATED', cheque: r.cheque });
      events.set(bill.id, list);
    }
    if (left > 0) unmatched = round2(unmatched + left);
  }

  return { events, applied, unmatched };
}

export interface RealisationInput {
  docs: RealisationDoc[];
  /** Receipts that moved a party balance but named no bill. */
  unallocatedReceipts?: UnallocatedReceipt[];
  from?: DateLike;
  to?: DateLike;
}

export interface RealisationSummary {
  /** Recognised because money arrived (or left) inside the window. */
  realisedRevenue: number;
  realisedCogs: number;
  /** Settlement discounts written off in the window — a real cost of collecting. */
  settlementDiscounts: number;
  realisedGrossProfit: number;
  /** Cash that drove the above, and the slice of it that is still an uncleared cheque. */
  realisedCash: number;
  realisedOnCheques: number;
  /** Receipts with no bill named, and how much of them the FIFO fallback could attach. */
  unallocatedReceipts: number;
  unallocatedReceiptsMatched: number;
  unallocatedReceiptsUnmatched: number;
  /** Of the SALES RAISED in this window: still owed, and the profit riding on it. */
  creditSalesOutstanding: number;
  unrealisedProfitOnCredit: number;
  /** Of the SALES RAISED in this window: profit collected so far, and the accrual profit on them. */
  realisedOnPeriodSales: number;
  periodSalesProfit: number;
  periodSalesCollectedPercent: number;
  /** Per-document detail, for the bill/item/party surfaces. */
  docs: DocRealisation[];
}

/**
 * The whole calculation. Two passes: the first works out what each bill can still absorb from
 * the recorded settlements, the second re-runs with the unallocated receipts FIFO'd in.
 */
export function realise(input: RealisationInput): RealisationSummary {
  const from = input.from != null ? msOf(input.from) : undefined;
  const to = input.to != null ? msOf(input.to) : undefined;
  const window: RealisationWindow = { from, to };
  const inWindow = (d: DateLike) => {
    const at = msOf(d);
    return (from == null || at >= from) && (to == null || at <= to);
  };

  const receipts = input.unallocatedReceipts ?? [];
  let extra = new Map<string, SettlementEvent[]>();
  let applied = 0;
  let unmatched = 0;
  const unallocatedTotal = round2(receipts.reduce((s, r) => s + r.amount, 0));

  if (receipts.length) {
    const bills: FifoBill[] = [];
    for (const doc of input.docs) {
      if (doc.txnType !== 'SALE_INVOICE' || !doc.partyKey) continue;
      const first = recogniseDoc(doc, window);
      if (first.outstanding > 0) bills.push({ id: doc.id, partyKey: doc.partyKey, date: doc.date, capacity: first.outstanding });
    }
    const spread = spreadUnallocated(receipts, bills);
    extra = spread.events;
    applied = spread.applied;
    unmatched = spread.unmatched;
  }

  const summary: RealisationSummary = {
    realisedRevenue: 0,
    realisedCogs: 0,
    settlementDiscounts: 0,
    realisedGrossProfit: 0,
    realisedCash: 0,
    realisedOnCheques: 0,
    unallocatedReceipts: unallocatedTotal,
    unallocatedReceiptsMatched: applied,
    unallocatedReceiptsUnmatched: unmatched,
    creditSalesOutstanding: 0,
    unrealisedProfitOnCredit: 0,
    realisedOnPeriodSales: 0,
    periodSalesProfit: 0,
    periodSalesCollectedPercent: 0,
    docs: [],
  };

  for (const doc of input.docs) {
    const added = extra.get(doc.id);
    const resolved = added ? { ...doc, events: [...doc.events, ...added] } : doc;
    const r = recogniseDoc(resolved, window);
    summary.docs.push(r);

    summary.realisedRevenue += r.periodRevenue;
    summary.realisedCogs += r.periodCogs;
    summary.settlementDiscounts += r.periodWriteOff;
    summary.realisedCash += r.periodCash;
    summary.realisedOnCheques += r.periodChequeCash;

    if (inWindow(doc.date)) {
      summary.realisedOnPeriodSales += r.collectedMargin;
      summary.periodSalesProfit += r.margin;
      if (doc.txnType === 'SALE_INVOICE') {
        summary.creditSalesOutstanding += r.outstanding;
        summary.unrealisedProfitOnCredit += r.outstandingMargin;
      }
    }
  }

  summary.realisedRevenue = round2(summary.realisedRevenue);
  summary.realisedCogs = round2(summary.realisedCogs);
  summary.settlementDiscounts = round2(summary.settlementDiscounts);
  summary.realisedGrossProfit = round2(summary.realisedRevenue - summary.realisedCogs - summary.settlementDiscounts);
  summary.realisedCash = round2(summary.realisedCash);
  summary.realisedOnCheques = round2(summary.realisedOnCheques);
  summary.creditSalesOutstanding = round2(summary.creditSalesOutstanding);
  summary.unrealisedProfitOnCredit = round2(summary.unrealisedProfitOnCredit);
  summary.realisedOnPeriodSales = round2(summary.realisedOnPeriodSales);
  summary.periodSalesProfit = round2(summary.periodSalesProfit);
  summary.periodSalesCollectedPercent = summary.periodSalesProfit === 0
    ? 0
    : round2((summary.realisedOnPeriodSales / summary.periodSalesProfit) * 100);

  return summary;
}
