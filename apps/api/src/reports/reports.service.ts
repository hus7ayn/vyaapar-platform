import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { branchWhere } from '../common/branch.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  RealisationDoc,
  SettlementEvent,
  UnallocatedReceipt,
  realise,
  round2,
} from './realisation.util';

const num = (v: Prisma.Decimal | number | null | undefined) => Number(v ?? 0);

/**
 * A payment is treated as cheque-backed when every tender on it is a cheque. Cheques ARE counted
 * as realised (see realisation.util) — this flag only lets the P&L show how much realised profit
 * is still paper in the drawer rather than money in the bank.
 */
const allCheque = (ps: { paymentType: string }[]) => ps.length > 0 && ps.every((p) => p.paymentType === 'CHEQUE');

/** Posted money only — never a parked (HELD) or cancelled bill. */
const POSTED: Prisma.TxnWhereInput = { deletedAt: null, status: { notIn: ['HELD', 'CANCELLED'] } };

/**
 * Everything one realisation document needs: its money, its goods, and — for a return — the
 * ORIGINAL sale line, so a return is costed at what the goods cost when they were sold.
 */
const DOC_ARGS = Prisma.validator<Prisma.TxnDefaultArgs>()({
  select: {
    id: true, txnType: true, date: true, total: true, taxAmount: true, partyId: true,
    lines: { select: { costPrice: true, quantity: true, sourceLine: { select: { costPrice: true } } } },
    payments: { select: { paymentType: true, amount: true } },
  },
});
type RealisationRow = Prisma.TxnGetPayload<typeof DOC_ARGS>;

function range(from?: string, to?: string) {
  const r: { gte?: Date; lte?: Date } = {};
  if (from) r.gte = new Date(from);
  if (to) { const d = new Date(to); d.setUTCHours(23, 59, 59, 999); r.lte = d; }
  return Object.keys(r).length ? r : undefined;
}

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  private txnWhere(businessId: string, txnType: string | string[], from?: string, to?: string, branchId?: string): Prisma.TxnWhereInput {
    return {
      businessId,
      deletedAt: null,
      status: { notIn: ['HELD', 'CANCELLED'] },
      txnType: Array.isArray(txnType) ? { in: txnType } : txnType,
      ...(branchId && { branchId }),
      ...(range(from, to) && { date: range(from, to) }),
    };
  }

  // ─── Realised (payment-based) profit ───────────────────────────────────────

  /**
   * Gather everything the realisation engine needs for one period and run it.
   *
   * Profit is recognised when the money arrives, pro rata to the bill it settles — see
   * realisation.util for the formula and the reasoning. This method does the I/O only; all of the
   * arithmetic lives in that pure module so every profit surface can share it.
   *
   * NOTE: party opening balances are PartyLedgerEntry rows with no txn and no goods behind them.
   * Nothing here ever reads them, so settling an opening balance can never invent profit.
   */
  private async saleRealisation(businessId: string, from?: string, to?: string, branchId?: string) {
    const r = range(from, to);
    const toDate = r?.lte;
    const branch: Prisma.TxnWhereInput = branchId ? { branchId } : {};

    // 1. Every sale-side document raised in the period. Its counter tenders have no date column
    //    of their own, so they are dated by the parent txn — which is this period.
    const periodDocs = await this.prisma.txn.findMany({
      where: this.txnWhere(businessId, ['SALE_INVOICE', 'CREDIT_NOTE'], from, to, branchId),
      ...DOC_ARGS,
    });

    // 2. Money that landed in the period against a bill raised earlier — dated by its payment.
    const periodAllocs = await this.prisma.billWiseAllocation.findMany({
      where: {
        businessId,
        againstTxn: { txnType: 'SALE_INVOICE', ...POSTED, ...branch },
        paymentTxn: { ...POSTED, ...(r && { date: r }) },
      },
      select: { againstTxnId: true },
    });

    // 3. Receipts that moved a party balance but named no bill (createPaymentIn with
    //    autoAllocate:false and no allocations writes NO BillWiseAllocation row). Real money —
    //    an allocation-only engine would silently under-recognise it.
    const paymentsIn = await this.prisma.txn.findMany({
      where: this.txnWhere(businessId, 'PAYMENT_IN', from, to, branchId),
      select: {
        id: true, date: true, total: true, partyId: true,
        payments: { select: { paymentType: true } },
        allocationsAsPayment: { select: { amount: true, discountAmount: true } },
      },
    });
    const unallocatedReceipts: UnallocatedReceipt[] = [];
    for (const p of paymentsIn) {
      if (!p.partyId) continue;
      const named = p.allocationsAsPayment.reduce((s, a) => s + num(a.amount) + num(a.discountAmount), 0);
      const left = round2(num(p.total) - named);
      if (left > 0.004) {
        unallocatedReceipts.push({ partyKey: p.partyId, amount: left, date: p.date, cheque: allCheque(p.payments) });
      }
    }

    // 4. The bills those loose receipts are matched against, oldest first. An unallocated payment
    //    never touched any bill's paidAmount, so a bill still carrying a balance is exactly the
    //    right candidate and this can never double-count a real allocation.
    const fifoParties = [...new Set(unallocatedReceipts.map((u) => u.partyKey))];
    const fifoBills = fifoParties.length
      ? await this.prisma.txn.findMany({
          where: {
            businessId, txnType: 'SALE_INVOICE', ...POSTED, ...branch,
            partyId: { in: fifoParties }, balance: { gt: 0 },
            ...(toDate && { date: { lte: toDate } }),
          },
          orderBy: { date: 'asc' }, take: 500, ...DOC_ARGS,
        })
      : [];

    // 5. The older bills named by (2) that are not loaded yet.
    const periodIds = new Set(periodDocs.map((d) => d.id));
    const loaded = new Map<string, RealisationRow>();
    for (const d of periodDocs) loaded.set(d.id, d);
    for (const d of fifoBills) loaded.set(d.id, d);
    const missing = [...new Set(periodAllocs.map((a) => a.againstTxnId))].filter((id) => !loaded.has(id));
    if (missing.length) {
      const extra = await this.prisma.txn.findMany({ where: { id: { in: missing }, businessId }, ...DOC_ARGS });
      for (const d of extra) loaded.set(d.id, d);
    }

    // 6. EVERY allocation against those documents up to the end of the period — not just the ones
    //    inside it — so each bill's collected fraction is complete and the split telescopes.
    const outsideIds = [...loaded.keys()].filter((id) => !periodIds.has(id));
    const allocs = await this.prisma.billWiseAllocation.findMany({
      where: {
        businessId,
        paymentTxn: { ...POSTED, ...(toDate && { date: { lte: toDate } }) },
        OR: [
          { againstTxn: this.txnWhere(businessId, 'SALE_INVOICE', from, to, branchId) },
          ...(outsideIds.length ? [{ againstTxnId: { in: outsideIds } }] : []),
        ],
      },
      select: {
        againstTxnId: true, amount: true, discountAmount: true,
        paymentTxn: { select: { date: true, payments: { select: { paymentType: true } } } },
      },
    });
    const allocEvents = new Map<string, SettlementEvent[]>();
    for (const a of allocs) {
      const list = allocEvents.get(a.againstTxnId) ?? [];
      // applyAllocations folds discountAmount into paidAmount, but a settlement discount is a
      // WRITE-OFF, not cash: it closes the bill without any money arriving, so only `amount`
      // recognises margin and the discount is charged against realised profit instead.
      list.push({
        amount: num(a.amount),
        writeOff: num(a.discountAmount),
        date: a.paymentTxn.date,
        source: 'ALLOCATION',
        cheque: allCheque(a.paymentTxn.payments),
      });
      allocEvents.set(a.againstTxnId, list);
    }

    const docs: RealisationDoc[] = [...loaded.values()].map((t) => ({
      id: t.id,
      txnType: t.txnType === 'CREDIT_NOTE' ? 'CREDIT_NOTE' : 'SALE_INVOICE',
      date: t.date,
      total: num(t.total),
      taxAmount: num(t.taxAmount),
      partyKey: t.partyId,
      lines: t.lines.map((l) => ({ costPrice: num(l.sourceLine?.costPrice ?? l.costPrice), quantity: num(l.quantity) })),
      events: [
        ...t.payments
          .filter((p) => p.paymentType !== 'DEBT' && num(p.amount) > 0)
          .map((p) => ({ amount: num(p.amount), date: t.date, source: 'TENDER' as const, cheque: p.paymentType === 'CHEQUE' })),
        ...(allocEvents.get(t.id) ?? []),
      ],
    }));

    return realise({ docs, unallocatedReceipts, from: r?.gte, to: toDate });
  }

  // ─── Dashboard (Home) ──────────────────────────────────────────────────────

  async dashboard(businessId: string, branchId?: string) {
    // UTC day/month boundaries, so the dashboard covers exactly the same window as a report run
    // for the same month (range() is UTC) and matches the UTC keys of the 7-day graph below.
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    const monthFrom = monthStart.toISOString().slice(0, 10);
    const monthTo = monthEnd.toISOString().slice(0, 10);

    const branchFilter = branchId ? { branchId } : {};
    const [todaySales, monthSales, monthReturns, parties, accounts, items, openOrders, monthExpenses, monthPayroll, recentTxns, realised] = await Promise.all([
      this.prisma.txn.aggregate({ where: { ...this.txnWhere(businessId, 'SALE_INVOICE', undefined, undefined, branchId), date: { gte: today } }, _sum: { total: true }, _count: true }),
      this.prisma.txn.aggregate({ where: { ...this.txnWhere(businessId, 'SALE_INVOICE', undefined, undefined, branchId), date: { gte: monthStart } }, _sum: { total: true }, _count: true }),
      this.prisma.txn.aggregate({ where: { ...this.txnWhere(businessId, 'CREDIT_NOTE', undefined, undefined, branchId), date: { gte: monthStart } }, _sum: { total: true } }),
      this.prisma.party.findMany({ where: { businessId, deletedAt: null, ...branchFilter } }),
      this.prisma.bankAccount.findMany({ where: { businessId, isActive: true, ...branchFilter } }),
      this.prisma.item.findMany({ where: { businessId, deletedAt: null, ...branchFilter } }),
      this.prisma.txn.count({ where: this.txnWhere(businessId, ['SALE_ORDER', 'PURCHASE_ORDER'], undefined, undefined, branchId) }),
      this.prisma.txn.aggregate({ where: { ...this.txnWhere(businessId, 'EXPENSE', undefined, undefined, branchId), date: { gte: monthStart } }, _sum: { total: true } }),
      this.prisma.payroll.aggregate({
        where: {
          businessId,
          status: 'PAID',
          paidAt: { gte: monthStart, lte: monthEnd },
          ...(branchId ? { branchId } : {}),
        },
        _sum: { totalAmount: true },
      }),
      this.prisma.txn.findMany({
        where: { businessId, deletedAt: null, status: { not: 'HELD' }, ...(branchId ? { branchId } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 10,
        include: { party: { select: { name: true } } },
      }),
      this.saleRealisation(businessId, monthFrom, monthTo, branchId),
    ]);

    let totalReceivable = 0, totalPayable = 0;
    for (const p of parties) {
      const b = num(p.currentBalance);
      if (b > 0) totalReceivable += b; else totalPayable += -b;
    }
    const cashInHand = accounts.filter((a) => a.accountType === 'CASH').reduce((s, a) => s + num(a.balance), 0);
    const bankBalance = accounts.filter((a) => a.accountType === 'BANK').reduce((s, a) => s + num(a.balance), 0);

    let stockValue = 0;
    let lowStockCount = 0;
    if (branchId && items.length) {
      const levels = await this.prisma.stockLevel.findMany({
        where: { branchId, itemId: { in: items.map((i) => i.id) } },
        select: { itemId: true, quantity: true },
      });
      const qtyMap = new Map(levels.map((l) => [l.itemId, num(l.quantity)]));
      for (const i of items) {
        const qty = qtyMap.get(i.id) ?? 0;
        stockValue += qty * num(i.costPrice || i.purchasePrice || i.salePrice);
        if (i.minStock != null && qty <= num(i.minStock)) lowStockCount++;
      }
    } else {
      stockValue = items.reduce((s, i) => s + num(i.currentStock) * num(i.costPrice || i.purchasePrice || i.salePrice), 0);
      lowStockCount = items.filter((i) => i.minStock != null && num(i.currentStock) <= num(i.minStock)).length;
    }

    // last 7 days sale graph
    const weekAgo = new Date(today); weekAgo.setUTCDate(weekAgo.getUTCDate() - 6);
    const weekTxns = await this.prisma.txn.findMany({
      where: { ...this.txnWhere(businessId, 'SALE_INVOICE', undefined, undefined, branchId), date: { gte: weekAgo } },
      select: { date: true, total: true },
    });
    const salesByDay: Record<string, number> = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekAgo); d.setUTCDate(d.getUTCDate() + i);
      salesByDay[d.toISOString().slice(0, 10)] = 0;
    }
    for (const t of weekTxns) {
      const key = t.date.toISOString().slice(0, 10);
      if (key in salesByDay) salesByDay[key] += num(t.total);
    }

    const monthSaleAmt = num(monthSales._sum.total);
    const monthReturnsAmt = num(monthReturns._sum.total);
    const monthExpenseAmt = num(monthExpenses._sum.total);
    const monthSalaryAmt = num(monthPayroll._sum.totalAmount);

    return {
      todaySale: num(todaySales._sum.total), todayInvoices: todaySales._count,
      monthSale: monthSaleAmt, monthInvoices: monthSales._count,
      monthReturns: monthReturnsAmt,
      monthExpense: monthExpenseAmt,
      monthSalary: monthSalaryAmt,
      // Net of sale-returns and expenses. NOTE: paying payroll already creates an EXPENSE txn, so
      // monthExpense ALREADY includes staff salary — we must NOT subtract monthSalary again here or
      // it double-counts. The figure is always <= Sale, so it never contradicts it.
      // This carries NO cost of goods at all, so it is NOT profit — the web card is labelled
      // "Sales − Returns − Expenses" accordingly. The profit figures are the realised ones below.
      netRevenue: monthSaleAmt - monthReturnsAmt - monthExpenseAmt,
      // Payment-based profit for the month: only bills the customer has actually paid for count.
      realisedGrossProfit: realised.realisedGrossProfit,
      realisedProfit: round2(realised.realisedGrossProfit - monthExpenseAmt),
      unrealisedProfitOnCredit: realised.unrealisedProfitOnCredit,
      creditSalesOutstanding: realised.creditSalesOutstanding,
      totalReceivable, totalPayable,
      cashInHand, bankBalance,
      stockValue, lowStockCount, openOrders,
      salesGraph: Object.entries(salesByDay).map(([date, total]) => ({ date, total })),
      recentTxns,
    };
  }

  // ─── Transaction reports ───────────────────────────────────────────────────

  async saleReport(businessId: string, from?: string, to?: string, branchId?: string) {
    const txns = await this.prisma.txn.findMany({
      where: this.txnWhere(businessId, ['SALE_INVOICE', 'CREDIT_NOTE'], from, to, branchId),
      include: { party: { select: { name: true } }, payments: true },
      orderBy: { date: 'desc' },
    });
    const sales = txns.filter((t) => t.txnType === 'SALE_INVOICE');
    const returns = txns.filter((t) => t.txnType === 'CREDIT_NOTE');
    return {
      txns,
      totalSale: sales.reduce((s, t) => s + num(t.total), 0),
      totalReturns: returns.reduce((s, t) => s + num(t.total), 0),
      totalBalance: sales.reduce((s, t) => s + num(t.balance), 0),
      count: sales.length,
    };
  }

  async purchaseReport(businessId: string, from?: string, to?: string, branchId?: string) {
    const txns = await this.prisma.txn.findMany({
      where: this.txnWhere(businessId, ['PURCHASE_BILL', 'DEBIT_NOTE'], from, to, branchId),
      include: { party: { select: { name: true } }, payments: true },
      orderBy: { date: 'desc' },
    });
    const bills = txns.filter((t) => t.txnType === 'PURCHASE_BILL');
    const returns = txns.filter((t) => t.txnType === 'DEBIT_NOTE');
    return {
      txns,
      totalPurchase: bills.reduce((s, t) => s + num(t.total), 0),
      totalReturns: returns.reduce((s, t) => s + num(t.total), 0),
      totalBalance: bills.reduce((s, t) => s + num(t.balance), 0),
      count: bills.length,
    };
  }

  async dayBook(businessId: string, date: string, branchId?: string) {
    const txns = await this.prisma.txn.findMany({
      where: this.txnWhere(businessId, ['SALE_INVOICE', 'CREDIT_NOTE', 'PURCHASE_BILL', 'DEBIT_NOTE', 'PAYMENT_IN', 'PAYMENT_OUT', 'EXPENSE', 'P2P_TRANSFER'], date, date, branchId),
      include: { party: { select: { name: true } } },
      orderBy: { date: 'asc' },
    });
    const moneyIn = ['SALE_INVOICE', 'PAYMENT_IN', 'DEBIT_NOTE'];
    const entries = txns.map((t) => ({
      id: t.id,
      type: t.txnType,
      ref: t.txnNumber,
      party: t.partyName ?? t.party?.name ?? '-',
      moneyIn: moneyIn.includes(t.txnType) ? num(t.paidAmount) : 0,
      moneyOut: !moneyIn.includes(t.txnType) && t.txnType !== 'P2P_TRANSFER' ? num(t.paidAmount) : 0,
      total: num(t.total),
      date: t.date,
    }));
    return {
      date,
      entries,
      totalMoneyIn: entries.reduce((s, e) => s + e.moneyIn, 0),
      totalMoneyOut: entries.reduce((s, e) => s + e.moneyOut, 0),
    };
  }

  async allTransactions(businessId: string, from?: string, to?: string, branchId?: string) {
    return this.prisma.txn.findMany({
      // ...POSTED, not `status != HELD`: a CANCELLED bill is not a transaction that happened, and
      // every other report already excludes it (txnWhere). Leaving it in made this list and the
      // cash-flow report disagree with the sale report on the same period.
      where: { businessId, ...POSTED, ...(branchId && { branchId }), ...(range(from, to) && { date: range(from, to) }) },
      include: { party: { select: { name: true } } },
      orderBy: { date: 'desc' },
      take: 500,
    });
  }

  async cashFlow(businessId: string, from?: string, to?: string, branchId?: string) {
    const payments = await this.prisma.txnPayment.findMany({
      where: {
        paymentType: { not: 'CHEQUE' },
        txn: { businessId, ...POSTED, ...(branchId && { branchId }), ...(range(from, to) && { date: range(from, to) }) },
      },
      include: { txn: { select: { txnType: true, txnNumber: true, partyName: true, date: true } } },
    });
    const inboundTypes = ['SALE_INVOICE', 'PAYMENT_IN', 'DEBIT_NOTE', 'SALE_ORDER'];
    const entries = payments.map((p) => ({
      date: p.txn.date,
      type: p.txn.txnType,
      ref: p.txn.txnNumber,
      party: p.txn.partyName ?? '-',
      paymentType: p.paymentType,
      cashIn: inboundTypes.includes(p.txn.txnType) ? num(p.amount) : 0,
      cashOut: inboundTypes.includes(p.txn.txnType) ? 0 : num(p.amount),
    })).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return {
      entries,
      totalIn: entries.reduce((s, e) => s + e.cashIn, 0),
      totalOut: entries.reduce((s, e) => s + e.cashOut, 0),
    };
  }

  /**
   * Bill-wise profit: per sale invoice, revenue minus cost of items sold.
   * `profit` is the accrual figure (booked the moment the bill was raised); `realisedProfit` is
   * the share the customer has actually paid for, and `percentCollected` says how much that is.
   */
  async billWiseProfit(businessId: string, from?: string, to?: string, branchId?: string) {
    const [invoices, realised] = await Promise.all([
      this.prisma.txn.findMany({
        where: this.txnWhere(businessId, ['SALE_INVOICE', 'CREDIT_NOTE'], from, to, branchId),
        include: { lines: true, party: { select: { name: true } } },
        orderBy: { date: 'desc' },
      }),
      this.saleRealisation(businessId, from, to, branchId),
    ]);
    const byDoc = new Map(realised.docs.map((d) => [d.id, d]));
    const rows = invoices.map((inv) => {
      const sign = inv.txnType === 'CREDIT_NOTE' ? -1 : 1;
      const cost = sign * inv.lines.reduce((s, l) => s + num(l.costPrice) * num(l.quantity), 0);
      const revenue = sign * (num(inv.total) - num(inv.taxAmount));
      const r = byDoc.get(inv.id);
      return {
        id: inv.id, txnNumber: inv.txnNumber, date: inv.date,
        party: inv.partyName ?? inv.party?.name ?? 'Cash Sale',
        total: sign * num(inv.total), revenue, cost, profit: revenue - cost,
        percentCollected: round2((r?.collectedFraction ?? 0) * 100),
        realisedProfit: r?.collectedMargin ?? 0,
        stillOwed: r?.outstanding ?? 0,
      };
    });
    return {
      rows,
      totalProfit: rows.reduce((s, r) => s + r.profit, 0),
      totalRealisedProfit: round2(rows.reduce((s, r) => s + r.realisedProfit, 0)),
      totalStillOwed: round2(rows.reduce((s, r) => s + r.stillOwed, 0)),
    };
  }

  // ─── Party reports ─────────────────────────────────────────────────────────

  async allParties(businessId: string, branchId?: string) {
    const parties = await this.prisma.party.findMany({ where: { businessId, deletedAt: null, ...branchWhere(branchId) }, orderBy: { name: 'asc' } });
    return parties.map((p) => ({
      id: p.id, name: p.name, phone: p.phone, gstin: p.gstin, partyType: p.partyType,
      receivable: num(p.currentBalance) > 0 ? num(p.currentBalance) : 0,
      payable: num(p.currentBalance) < 0 ? -num(p.currentBalance) : 0,
    }));
  }

  /**
   * Party-wise profit. `realisedProfit` weights each bill by the share of it the party has
   * actually paid, on the same basis as bill-wise profit, so the two agree row for row.
   * (Settlement write-offs are a bill-level cost and are reported on the P&L, not split here.)
   */
  async partyWiseProfit(businessId: string, from?: string, to?: string, branchId?: string) {
    const [invoices, realised] = await Promise.all([
      this.prisma.txn.findMany({
        where: this.txnWhere(businessId, ['SALE_INVOICE', 'CREDIT_NOTE'], from, to, branchId),
        include: { lines: true },
      }),
      this.saleRealisation(businessId, from, to, branchId),
    ]);
    const byDoc = new Map(realised.docs.map((d) => [d.id, d]));
    const byParty: Record<string, { party: string; sales: number; profit: number; realisedSales: number; realisedProfit: number; stillOwed: number; count: number }> = {};
    for (const inv of invoices) {
      const key = inv.partyId ?? inv.partyName ?? 'Cash Sale';
      const name = inv.partyName ?? 'Cash Sale';
      if (!byParty[key]) byParty[key] = { party: name, sales: 0, profit: 0, realisedSales: 0, realisedProfit: 0, stillOwed: 0, count: 0 };
      const sign = inv.txnType === 'CREDIT_NOTE' ? -1 : 1;
      const cost = sign * inv.lines.reduce((s, l) => s + num(l.costPrice) * num(l.quantity), 0);
      const sales = sign * num(inv.total);
      const profit = sign * (num(inv.total) - num(inv.taxAmount)) - cost;
      const collected = byDoc.get(inv.id)?.collectedFraction ?? 0;
      byParty[key].sales += sales;
      byParty[key].profit += profit;
      byParty[key].realisedSales += round2(sales * collected);
      byParty[key].realisedProfit += round2(profit * collected);
      byParty[key].stillOwed += byDoc.get(inv.id)?.outstanding ?? 0;
      byParty[key].count++;
    }
    for (const row of Object.values(byParty)) {
      row.realisedSales = round2(row.realisedSales);
      row.realisedProfit = round2(row.realisedProfit);
      row.stillOwed = round2(row.stillOwed);
    }
    return Object.values(byParty).sort((a, b) => b.sales - a.sales);
  }

  async salePurchaseByParty(businessId: string, from?: string, to?: string, branchId?: string) {
    const txns = await this.prisma.txn.findMany({
      where: this.txnWhere(businessId, ['SALE_INVOICE', 'PURCHASE_BILL'], from, to, branchId),
    });
    const byParty: Record<string, { party: string; sale: number; purchase: number }> = {};
    for (const t of txns) {
      const key = t.partyId ?? t.partyName ?? 'Cash';
      const name = t.partyName ?? 'Cash';
      if (!byParty[key]) byParty[key] = { party: name, sale: 0, purchase: 0 };
      if (t.txnType === 'SALE_INVOICE') byParty[key].sale += num(t.total);
      else byParty[key].purchase += num(t.total);
    }
    return Object.values(byParty).sort((a, b) => (b.sale + b.purchase) - (a.sale + a.purchase));
  }

  // ─── Item / stock reports ──────────────────────────────────────────────────

  async stockSummary(businessId: string, branchId?: string) {
    const items = await this.prisma.item.findMany({
      where: { businessId, deletedAt: null, itemType: 'PRODUCT', ...branchWhere(branchId) },
      include: { category: true },
      orderBy: { name: 'asc' },
    });
    const qtyMap = new Map<string, number>();
    if (branchId && items.length) {
      const levels = await this.prisma.stockLevel.findMany({
        where: { branchId, itemId: { in: items.map((i) => i.id) } },
        select: { itemId: true, quantity: true },
      });
      for (const l of levels) qtyMap.set(l.itemId, num(l.quantity));
    }
    const rows = items.map((i) => {
      const stockQty = branchId ? (qtyMap.get(i.id) ?? 0) : num(i.currentStock);
      const unitPrice = num(i.costPrice || i.purchasePrice || i.salePrice);
      return {
        id: i.id, name: i.name, sku: i.sku, category: i.category?.name,
        salePrice: num(i.salePrice), purchasePrice: num(i.purchasePrice),
        stockQty, minStock: i.minStock != null ? num(i.minStock) : null,
        stockValue: stockQty * unitPrice,
        unit: i.baseUnit,
      };
    });
    return { rows, totalValue: rows.reduce((s, r) => s + r.stockValue, 0), totalQty: rows.reduce((s, r) => s + r.stockQty, 0) };
  }

  /**
   * Item-wise profit. `realisedProfit` weights every line by the share of its bill the customer
   * has actually paid — the same weight bill-wise and party-wise profit use, so all three agree.
   * The realised cost of a returned line is the ORIGINAL sale's cost (sourceLine), not the item's
   * cost today, so a price change between sale and return leaves no residual.
   */
  async itemWiseProfit(businessId: string, from?: string, to?: string, branchId?: string) {
    const [lines, realised] = await Promise.all([
      this.prisma.txnLine.findMany({
        where: { txn: this.txnWhere(businessId, ['SALE_INVOICE', 'CREDIT_NOTE'], from, to, branchId) },
        include: {
          item: { select: { name: true, sku: true } },
          txn: { select: { id: true, txnType: true } },
          sourceLine: { select: { costPrice: true } },
        },
      }),
      this.saleRealisation(businessId, from, to, branchId),
    ]);
    const byDoc = new Map(realised.docs.map((d) => [d.id, d]));
    const byItem: Record<string, { item: string; qty: number; revenue: number; cost: number; profit: number; realisedRevenue: number; realisedProfit: number }> = {};
    for (const l of lines) {
      const key = l.itemId ?? l.name;
      const name = l.item?.name ?? l.name;
      if (!byItem[key]) byItem[key] = { item: name, qty: 0, revenue: 0, cost: 0, profit: 0, realisedRevenue: 0, realisedProfit: 0 };
      const sign = l.txn.txnType === 'CREDIT_NOTE' ? -1 : 1;
      const revenue = sign * (num(l.total) - num(l.taxAmount));
      const cost = sign * num(l.costPrice) * num(l.quantity);
      const collected = byDoc.get(l.txn.id)?.collectedFraction ?? 0;
      const realisedCost = sign * num(l.sourceLine?.costPrice ?? l.costPrice) * num(l.quantity);
      byItem[key].qty += sign * num(l.quantity);
      byItem[key].revenue += revenue;
      byItem[key].cost += cost;
      byItem[key].profit += revenue - cost;
      byItem[key].realisedRevenue += round2(revenue * collected);
      byItem[key].realisedProfit += round2((revenue - realisedCost) * collected);
    }
    for (const row of Object.values(byItem)) {
      row.realisedRevenue = round2(row.realisedRevenue);
      row.realisedProfit = round2(row.realisedProfit);
    }
    return Object.values(byItem).sort((a, b) => b.profit - a.profit);
  }

  async lowStock(businessId: string, branchId?: string) {
    const items = await this.prisma.item.findMany({
      where: { businessId, deletedAt: null, itemType: 'PRODUCT', minStock: { not: null }, ...branchWhere(branchId) },
    });
    const qtyMap = new Map<string, number>();
    if (branchId && items.length) {
      const levels = await this.prisma.stockLevel.findMany({
        where: { branchId, itemId: { in: items.map((i) => i.id) } },
        select: { itemId: true, quantity: true },
      });
      for (const l of levels) qtyMap.set(l.itemId, num(l.quantity));
    }
    return items
      .filter((i) => {
        const qty = branchId ? (qtyMap.get(i.id) ?? 0) : num(i.currentStock);
        return qty <= num(i.minStock);
      })
      .map((i) => ({
        id: i.id, name: i.name, sku: i.sku,
        currentStock: branchId ? (qtyMap.get(i.id) ?? 0) : num(i.currentStock),
        minStock: num(i.minStock), unit: i.baseUnit,
      }));
  }

  async stockDetail(businessId: string, itemId?: string, from?: string, to?: string, branchId?: string) {
    const movements = await this.prisma.stockMovement.findMany({
      where: {
        businessId,
        ...branchWhere(branchId),
        ...(itemId && { itemId }),
        ...(range(from, to) && { createdAt: range(from, to) }),
      },
      include: { item: { select: { name: true, sku: true } }, warehouse: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return movements.map((m) => ({
      date: m.createdAt, item: m.item.name, sku: m.item.sku,
      type: m.type, quantity: num(m.quantity), warehouse: m.warehouse.name, reference: m.reference,
    }));
  }

  async byItemCategory(businessId: string, side: 'sale' | 'purchase', from?: string, to?: string, branchId?: string) {
    const lines = await this.prisma.txnLine.findMany({
      where: { txn: this.txnWhere(businessId, side === 'sale' ? 'SALE_INVOICE' : 'PURCHASE_BILL', from, to, branchId) },
      include: { item: { include: { category: true } } },
    });
    const byCat: Record<string, { category: string; qty: number; amount: number }> = {};
    for (const l of lines) {
      const cat = l.item?.category?.name ?? 'Uncategorized';
      if (!byCat[cat]) byCat[cat] = { category: cat, qty: 0, amount: 0 };
      byCat[cat].qty += num(l.quantity);
      byCat[cat].amount += num(l.total);
    }
    return Object.values(byCat).sort((a, b) => b.amount - a.amount);
  }

  async discountReport(businessId: string, from?: string, to?: string, branchId?: string) {
    const txns = await this.prisma.txn.findMany({
      where: this.txnWhere(businessId, ['SALE_INVOICE', 'CREDIT_NOTE'], from, to, branchId),
      include: { lines: true },
    });
    const rows = txns
      .map((t) => ({
        txnNumber: t.txnNumber, date: t.date, party: t.partyName ?? 'Cash Sale',
        lineDiscount: t.lines.reduce((s, l) => s + num(l.discountAmount), 0),
        billDiscount: num(t.discountAmount),
      }))
      .filter((r) => r.lineDiscount > 0 || r.billDiscount > 0);
    return { rows, totalDiscount: rows.reduce((s, r) => s + r.lineDiscount + r.billDiscount, 0) };
  }

  // ─── Financial statements ──────────────────────────────────────────────────

  /**
   * Profit & Loss, on BOTH bases.
   *
   * The accrual figures (netSales, cogs, grossProfit, netProfit …) book a sale the moment the
   * bill is raised, paid or not. The realised figures book profit only when the money actually
   * arrives, pro rata to the bill it settles — that is the headline the owner asked for, because
   * a credit sale is a receivable, not earnings. Both are returned so the two can be reconciled
   * on screen: realisedGrossProfit + (profit still out on credit) is what accrual claimed.
   *
   * None of this reaches the GST reports: output tax is a liability the day the invoice is
   * raised, by law, and gstr1/gstr2/gstr3b stay invoice-dated and untouched.
   */
  /** The accrual half of the P&L, on its own — the balance sheet needs only this. */
  private async accrualPnl(businessId: string, from?: string, to?: string, branchId?: string) {
    const [sales, saleReturns, purchases, purchaseReturns, expenses, saleLines, saleReturnLines] = await Promise.all([
      this.prisma.txn.aggregate({ where: this.txnWhere(businessId, 'SALE_INVOICE', from, to, branchId), _sum: { total: true, taxAmount: true } }),
      this.prisma.txn.aggregate({ where: this.txnWhere(businessId, 'CREDIT_NOTE', from, to, branchId), _sum: { total: true, taxAmount: true } }),
      this.prisma.txn.aggregate({ where: this.txnWhere(businessId, 'PURCHASE_BILL', from, to, branchId), _sum: { total: true, taxAmount: true } }),
      this.prisma.txn.aggregate({ where: this.txnWhere(businessId, 'DEBIT_NOTE', from, to, branchId), _sum: { total: true } }),
      this.prisma.txn.aggregate({ where: this.txnWhere(businessId, 'EXPENSE', from, to, branchId), _sum: { total: true } }),
      this.prisma.txnLine.findMany({
        where: { txn: this.txnWhere(businessId, 'SALE_INVOICE', from, to, branchId) },
        select: { costPrice: true, quantity: true },
      }),
      this.prisma.txnLine.findMany({
        where: { txn: this.txnWhere(businessId, 'CREDIT_NOTE', from, to, branchId) },
        select: { costPrice: true, quantity: true, sourceLine: { select: { costPrice: true } } },
      }),
    ]);

    const grossSale = num(sales._sum.total) - num(saleReturns._sum.total);

    // BUGFIX (changes historical figures): sale-return tax used to be deducted TWICE. The
    // returned total already carries its own GST and is subtracted above, and then the gross
    // output-tax figure — never netted of returns — was subtracted again. A full return of a
    // 118 bill (100 + 18 GST, cost 60) reported a gross profit of -18 instead of 0. Bill-wise
    // profit has always done this right with a signed per-txn (total - taxAmount); this is the
    // same thing in aggregate.
    const outputTax = num(sales._sum.taxAmount);
    const saleReturnTax = num(saleReturns._sum.taxAmount);
    const netOutputTax = outputTax - saleReturnTax;

    // BUGFIX (changes historical figures): a return's COGS is what the goods cost WHEN THEY WERE
    // SOLD. A credit-note line stamps the item's cost on the day of the return, so if the item's
    // cost moved in between, reversing at the new cost left a residual in COGS that belonged to
    // no sale. sourceLine is the exact original invoice line, so the reversal is exact.
    const cogs = saleLines.reduce((s, l) => s + num(l.costPrice) * num(l.quantity), 0)
      - saleReturnLines.reduce((s, l) => s + num(l.sourceLine?.costPrice ?? l.costPrice) * num(l.quantity), 0);
    const grossProfit = grossSale - netOutputTax - cogs;
    const totalExpenses = num(expenses._sum.total);

    // One clear vocabulary so no surface can show "Total Sale" exceeding "Total Revenue" on a
    // different basis (the A2 bug): Gross Sales -> minus Returns -> Net Sales (== Revenue).
    return {
      grossSales: num(sales._sum.total),
      saleReturns: num(saleReturns._sum.total),
      netSales: grossSale,
      purchase: num(purchases._sum.total),
      purchaseReturns: num(purchaseReturns._sum.total),
      cogs,
      grossProfit,
      expenses: totalExpenses,
      netProfit: grossProfit - totalExpenses,
      outputTax,
      inputTax: num(purchases._sum.taxAmount),
      outputTaxOnReturns: saleReturnTax,
      netOutputTax,
    };
  }

  async profitAndLoss(businessId: string, from?: string, to?: string, branchId?: string) {
    const [accrual, realised] = await Promise.all([
      this.accrualPnl(businessId, from, to, branchId),
      this.saleRealisation(businessId, from, to, branchId),
    ]);

    return {
      ...accrual,

      // ── Realised (payment-based) ─────────────────────────────────────────────
      // Money in this period against any bill, old or new, pro rata to that bill's margin.
      realisedRevenue: realised.realisedRevenue,
      realisedCogs: realised.realisedCogs,
      realisedGrossProfit: realised.realisedGrossProfit,
      // Expenses are already cash-settled when they are booked, so the two bases share them.
      realisedNetProfit: round2(realised.realisedGrossProfit - accrual.expenses),
      // Of the sales raised IN this period: what is still owed, and the profit riding on it.
      creditSalesOutstanding: realised.creditSalesOutstanding,
      unrealisedProfitOnCredit: realised.unrealisedProfitOnCredit,
      // Of the sales raised IN this period: profit collected so far. This is the figure the
      // bill-wise / item-wise / party-wise reports total, so those surfaces reconcile with this.
      realisedOnPeriodSales: realised.realisedOnPeriodSales,
      // Settlement discounts written off to close a bill: they settle it without any cash, so
      // they earn no margin and are charged against realised profit.
      settlementDiscounts: realised.settlementDiscounts,
      // Cash behind the realised figures, and the slice still sitting as an uncleared cheque.
      realisedCashCollected: realised.realisedCash,
      realisedOnCheques: realised.realisedOnCheques,
      // Receipts that named no bill, and how much of them could be matched FIFO at report time.
      unallocatedReceipts: realised.unallocatedReceipts,
      unallocatedReceiptsMatched: realised.unallocatedReceiptsMatched,
      unallocatedReceiptsUnmatched: realised.unallocatedReceiptsUnmatched,
    };
  }

  async trialBalance(businessId: string, branchId?: string) {
    const [parties, accounts, items, sales, saleReturns, purchases, purchaseReturns, expenses, loans] = await Promise.all([
      this.prisma.party.findMany({ where: { businessId, deletedAt: null, ...branchWhere(branchId) } }),
      this.prisma.bankAccount.findMany({ where: { businessId, isActive: true, ...branchWhere(branchId) } }),
      this.prisma.item.findMany({ where: { businessId, deletedAt: null, ...branchWhere(branchId) } }),
      this.prisma.txn.aggregate({ where: this.txnWhere(businessId, 'SALE_INVOICE', undefined, undefined, branchId), _sum: { total: true } }),
      this.prisma.txn.aggregate({ where: this.txnWhere(businessId, 'CREDIT_NOTE', undefined, undefined, branchId), _sum: { total: true } }),
      this.prisma.txn.aggregate({ where: this.txnWhere(businessId, 'PURCHASE_BILL', undefined, undefined, branchId), _sum: { total: true } }),
      this.prisma.txn.aggregate({ where: this.txnWhere(businessId, 'DEBIT_NOTE', undefined, undefined, branchId), _sum: { total: true } }),
      this.prisma.txn.aggregate({ where: this.txnWhere(businessId, 'EXPENSE', undefined, undefined, branchId), _sum: { total: true } }),
      this.prisma.loanAccount.aggregate({ where: { businessId, isActive: true, ...branchWhere(branchId) }, _sum: { currentBalance: true } }),
    ]);

    let receivable = 0, payable = 0;
    for (const p of parties) {
      const b = num(p.currentBalance);
      if (b > 0) receivable += b; else payable += -b;
    }
    const cashBank = accounts.reduce((s, a) => s + num(a.balance), 0);
    let stockValue = 0;
    if (branchId && items.length) {
      const levels = await this.prisma.stockLevel.findMany({
        where: { branchId, itemId: { in: items.map((i) => i.id) } },
        select: { itemId: true, quantity: true },
      });
      const qtyMap = new Map(levels.map((l) => [l.itemId, num(l.quantity)]));
      stockValue = items.reduce((s, i) => {
        const qty = qtyMap.get(i.id) ?? 0;
        return s + qty * num(i.costPrice || i.purchasePrice || i.salePrice);
      }, 0);
    } else {
      stockValue = items.reduce((s, i) => s + num(i.currentStock) * num(i.costPrice || i.purchasePrice || i.salePrice), 0);
    }

    const accountsList = [
      { name: 'Cash & Bank', debit: Math.max(0, cashBank), credit: Math.max(0, -cashBank) },
      { name: 'Accounts Receivable (Sundry Debtors)', debit: receivable, credit: 0 },
      { name: 'Closing Stock', debit: stockValue, credit: 0 },
      { name: 'Accounts Payable (Sundry Creditors)', debit: 0, credit: payable },
      { name: 'Loan Accounts', debit: 0, credit: num(loans._sum.currentBalance) },
      { name: 'Sales', debit: num(saleReturns._sum.total), credit: num(sales._sum.total) },
      { name: 'Purchases', debit: num(purchases._sum.total), credit: num(purchaseReturns._sum.total) },
      { name: 'Expenses (Indirect)', debit: num(expenses._sum.total), credit: 0 },
    ];
    return {
      accounts: accountsList,
      totalDebit: accountsList.reduce((s, a) => s + a.debit, 0),
      totalCredit: accountsList.reduce((s, a) => s + a.credit, 0),
    };
  }

  async balanceSheet(businessId: string, branchId?: string) {
    const tb = await this.trialBalance(businessId, branchId);
    const get = (name: string) => tb.accounts.find((a) => a.name.startsWith(name)) ?? { debit: 0, credit: 0 };
    // Accrual only: retained earnings on the balance sheet are the booked figure, and running the
    // realisation engine over all of history for a number this screen never shows would be waste.
    const pnl = await this.accrualPnl(businessId, undefined, undefined, branchId);

    const cashBank = get('Cash & Bank').debit - get('Cash & Bank').credit;
    const receivable = get('Accounts Receivable').debit;
    const stock = get('Closing Stock').debit;
    const payable = get('Accounts Payable').credit;
    const loans = get('Loan Accounts').credit;

    const totalAssets = cashBank + receivable + stock;
    const totalLiabilities = payable + loans;
    const equity = totalAssets - totalLiabilities;

    return {
      assets: { cashAndBank: cashBank, receivables: receivable, closingStock: stock, total: totalAssets },
      liabilities: { payables: payable, loans, total: totalLiabilities },
      equity: { retainedEarnings: pnl.netProfit, ownersCapital: equity - pnl.netProfit, total: equity },
      totalLiabilitiesAndEquity: totalLiabilities + equity,
    };
  }

  // ─── GST reports ───────────────────────────────────────────────────────────

  private async gstData(businessId: string, from?: string, to?: string, branchId?: string) {
    const [saleTxns, purchaseTxns] = await Promise.all([
      this.prisma.txn.findMany({
        where: this.txnWhere(businessId, ['SALE_INVOICE', 'CREDIT_NOTE'], from, to, branchId),
        include: { lines: true, party: { select: { name: true, gstin: true, state: true } } },
      }),
      this.prisma.txn.findMany({
        where: this.txnWhere(businessId, ['PURCHASE_BILL', 'DEBIT_NOTE'], from, to, branchId),
        include: { lines: true, party: { select: { name: true, gstin: true, state: true } } },
      }),
    ]);
    const business = await this.prisma.business.findUnique({ where: { id: businessId } });
    return { saleTxns, purchaseTxns, homeState: business?.state ?? null };
  }

  private splitTax(txn: { stateOfSupply?: string | null }, homeState: string | null, tax: number) {
    const interState = !!(txn.stateOfSupply && homeState && txn.stateOfSupply !== homeState);
    return interState
      ? { cgst: 0, sgst: 0, igst: tax }
      : { cgst: tax / 2, sgst: tax / 2, igst: 0 };
  }

  async gstr1(businessId: string, from?: string, to?: string, branchId?: string) {
    const { saleTxns, homeState } = await this.gstData(businessId, from, to, branchId);
    const rows = saleTxns.map((t) => {
      const sign = t.txnType === 'CREDIT_NOTE' ? -1 : 1;
      const tax = num(t.taxAmount) * sign;
      const taxable = (num(t.total) - num(t.taxAmount)) * sign;
      return {
        txnNumber: t.txnNumber, txnType: t.txnType, date: t.date,
        party: t.partyName ?? 'Cash Sale', gstin: t.party?.gstin ?? null,
        invoiceValue: num(t.total) * sign, taxable, ...this.splitTax(t, homeState, tax), totalTax: tax,
      };
    });
    const b2b = rows.filter((r) => r.gstin);
    const b2c = rows.filter((r) => !r.gstin);
    return {
      rows,
      summary: {
        b2bCount: b2b.length, b2bValue: b2b.reduce((s, r) => s + r.invoiceValue, 0),
        b2cCount: b2c.length, b2cValue: b2c.reduce((s, r) => s + r.invoiceValue, 0),
        taxableValue: rows.reduce((s, r) => s + r.taxable, 0),
        cgst: rows.reduce((s, r) => s + r.cgst, 0),
        sgst: rows.reduce((s, r) => s + r.sgst, 0),
        igst: rows.reduce((s, r) => s + r.igst, 0),
        totalTax: rows.reduce((s, r) => s + r.totalTax, 0),
      },
    };
  }

  async gstr2(businessId: string, from?: string, to?: string, branchId?: string) {
    const { purchaseTxns, homeState } = await this.gstData(businessId, from, to, branchId);
    const rows = purchaseTxns.map((t) => {
      const sign = t.txnType === 'DEBIT_NOTE' ? -1 : 1;
      const tax = num(t.taxAmount) * sign;
      const taxable = (num(t.total) - num(t.taxAmount)) * sign;
      return {
        txnNumber: t.txnNumber, txnType: t.txnType, date: t.date,
        party: t.partyName ?? '-', gstin: t.party?.gstin ?? null,
        invoiceValue: num(t.total) * sign, taxable, ...this.splitTax(t, homeState, tax), totalTax: tax,
      };
    });
    return {
      rows,
      summary: {
        count: rows.length,
        taxableValue: rows.reduce((s, r) => s + r.taxable, 0),
        cgst: rows.reduce((s, r) => s + r.cgst, 0),
        sgst: rows.reduce((s, r) => s + r.sgst, 0),
        igst: rows.reduce((s, r) => s + r.igst, 0),
        totalTax: rows.reduce((s, r) => s + r.totalTax, 0),
      },
    };
  }

  async gstr3b(businessId: string, from?: string, to?: string, branchId?: string) {
    const [g1, g2] = await Promise.all([
      this.gstr1(businessId, from, to, branchId),
      this.gstr2(businessId, from, to, branchId),
    ]);
    return {
      outward: { taxable: g1.summary.taxableValue, cgst: g1.summary.cgst, sgst: g1.summary.sgst, igst: g1.summary.igst, totalTax: g1.summary.totalTax },
      inwardItc: { taxable: g2.summary.taxableValue, cgst: g2.summary.cgst, sgst: g2.summary.sgst, igst: g2.summary.igst, totalTax: g2.summary.totalTax },
      netPayable: {
        cgst: Math.max(0, g1.summary.cgst - g2.summary.cgst),
        sgst: Math.max(0, g1.summary.sgst - g2.summary.sgst),
        igst: Math.max(0, g1.summary.igst - g2.summary.igst),
        total: Math.max(0, g1.summary.totalTax - g2.summary.totalTax),
      },
    };
  }

  async hsnSummary(businessId: string, from?: string, to?: string, branchId?: string) {
    const lines = await this.prisma.txnLine.findMany({
      where: { txn: this.txnWhere(businessId, ['SALE_INVOICE', 'CREDIT_NOTE'], from, to, branchId) },
      include: { txn: { select: { txnType: true } } },
    });
    const byHsn: Record<string, { hsn: string; qty: number; taxable: number; tax: number; total: number }> = {};
    for (const l of lines) {
      const sign = l.txn.txnType === 'CREDIT_NOTE' ? -1 : 1;
      const hsn = l.hsnCode ?? 'N/A';
      if (!byHsn[hsn]) byHsn[hsn] = { hsn, qty: 0, taxable: 0, tax: 0, total: 0 };
      byHsn[hsn].qty += num(l.quantity) * sign;
      byHsn[hsn].taxable += (num(l.total) - num(l.taxAmount)) * sign;
      byHsn[hsn].tax += num(l.taxAmount) * sign;
      byHsn[hsn].total += num(l.total) * sign;
    }
    return Object.values(byHsn).sort((a, b) => b.total - a.total);
  }

  async taxRateReport(businessId: string, from?: string, to?: string, branchId?: string) {
    const [saleLines, purchaseLines] = await Promise.all([
      this.prisma.txnLine.findMany({
        where: { txn: this.txnWhere(businessId, ['SALE_INVOICE', 'CREDIT_NOTE'], from, to, branchId) },
        include: { txn: { select: { txnType: true } } },
      }),
      this.prisma.txnLine.findMany({
        where: { txn: this.txnWhere(businessId, ['PURCHASE_BILL', 'DEBIT_NOTE'], from, to, branchId) },
        include: { txn: { select: { txnType: true } } },
      }),
    ]);
    const byRate: Record<string, { rate: number; saleTaxable: number; saleTax: number; purchaseTaxable: number; purchaseTax: number }> = {};
    for (const l of saleLines) {
      const sign = l.txn.txnType === 'CREDIT_NOTE' ? -1 : 1;
      const rate = num(l.taxRate);
      const key = rate.toFixed(2);
      if (!byRate[key]) byRate[key] = { rate, saleTaxable: 0, saleTax: 0, purchaseTaxable: 0, purchaseTax: 0 };
      byRate[key].saleTaxable += (num(l.total) - num(l.taxAmount)) * sign;
      byRate[key].saleTax += num(l.taxAmount) * sign;
    }
    for (const l of purchaseLines) {
      const sign = l.txn.txnType === 'DEBIT_NOTE' ? -1 : 1;
      const rate = num(l.taxRate);
      const key = rate.toFixed(2);
      if (!byRate[key]) byRate[key] = { rate, saleTaxable: 0, saleTax: 0, purchaseTaxable: 0, purchaseTax: 0 };
      byRate[key].purchaseTaxable += (num(l.total) - num(l.taxAmount)) * sign;
      byRate[key].purchaseTax += num(l.taxAmount) * sign;
    }
    return Object.values(byRate).sort((a, b) => a.rate - b.rate);
  }

  // ─── Order reports ─────────────────────────────────────────────────────────

  async orderReport(businessId: string, side: 'sale' | 'purchase', status?: string, branchId?: string) {
    const txns = await this.prisma.txn.findMany({
      where: {
        businessId, deletedAt: null,
        txnType: side === 'sale' ? 'SALE_ORDER' : 'PURCHASE_ORDER',
        ...branchWhere(branchId),
        ...(status && { status }),
      },
      include: { party: { select: { name: true } } },
      orderBy: { date: 'desc' },
    });
    return {
      txns,
      openCount: txns.filter((t) => t.status === 'ORDER_OPEN').length,
      closedCount: txns.filter((t) => t.status === 'ORDER_CLOSED').length,
      openValue: txns.filter((t) => t.status === 'ORDER_OPEN').reduce((s, t) => s + num(t.total), 0),
    };
  }
}
