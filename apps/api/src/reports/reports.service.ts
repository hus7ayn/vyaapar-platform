import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { branchWhere } from '../common/branch.util';
import { PrismaService } from '../prisma/prisma.service';

const num = (v: Prisma.Decimal | number | null | undefined) => Number(v ?? 0);

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

  // ─── Dashboard (Home) ──────────────────────────────────────────────────────

  async dashboard(businessId: string, branchId?: string) {
    const today = new Date(); today.setHours(0, 0, 0, 0);

    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);

    const branchFilter = branchId ? { branchId } : {};
    const [todaySales, monthSales, parties, accounts, items, openOrders, monthExpenses, monthPayroll, recentTxns] = await Promise.all([
      this.prisma.txn.aggregate({ where: { ...this.txnWhere(businessId, 'SALE_INVOICE', undefined, undefined, branchId), date: { gte: today } }, _sum: { total: true }, _count: true }),
      this.prisma.txn.aggregate({ where: { ...this.txnWhere(businessId, 'SALE_INVOICE', undefined, undefined, branchId), date: { gte: monthStart } }, _sum: { total: true }, _count: true }),
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
      stockValue = items.reduce((s, i) => s + num(i.currentStock) * num(i.purchasePrice || i.salePrice), 0);
      lowStockCount = items.filter((i) => i.minStock != null && num(i.currentStock) <= num(i.minStock)).length;
    }

    // last 7 days sale graph
    const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 6);
    const weekTxns = await this.prisma.txn.findMany({
      where: { ...this.txnWhere(businessId, 'SALE_INVOICE', undefined, undefined, branchId), date: { gte: weekAgo } },
      select: { date: true, total: true },
    });
    const salesByDay: Record<string, number> = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekAgo); d.setDate(d.getDate() + i);
      salesByDay[d.toISOString().slice(0, 10)] = 0;
    }
    for (const t of weekTxns) {
      const key = t.date.toISOString().slice(0, 10);
      if (key in salesByDay) salesByDay[key] += num(t.total);
    }

    const monthSaleAmt = num(monthSales._sum.total);
    const monthExpenseAmt = num(monthExpenses._sum.total);
    const monthSalaryAmt = num(monthPayroll._sum.totalAmount);

    return {
      todaySale: num(todaySales._sum.total), todayInvoices: todaySales._count,
      monthSale: monthSaleAmt, monthInvoices: monthSales._count,
      monthExpense: monthExpenseAmt,
      monthSalary: monthSalaryAmt,
      netRevenue: monthSaleAmt - monthExpenseAmt,
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
      where: { businessId, deletedAt: null, status: { not: 'HELD' }, ...(branchId && { branchId }), ...(range(from, to) && { date: range(from, to) }) },
      include: { party: { select: { name: true } } },
      orderBy: { date: 'desc' },
      take: 500,
    });
  }

  async cashFlow(businessId: string, from?: string, to?: string, branchId?: string) {
    const payments = await this.prisma.txnPayment.findMany({
      where: {
        paymentType: { not: 'CHEQUE' },
        txn: { businessId, deletedAt: null, status: { not: 'HELD' }, ...(branchId && { branchId }), ...(range(from, to) && { date: range(from, to) }) },
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

  /** Bill-wise profit: per sale invoice, revenue minus cost of items sold. */
  async billWiseProfit(businessId: string, from?: string, to?: string, branchId?: string) {
    const invoices = await this.prisma.txn.findMany({
      where: this.txnWhere(businessId, ['SALE_INVOICE', 'CREDIT_NOTE'], from, to, branchId),
      include: { lines: true, party: { select: { name: true } } },
      orderBy: { date: 'desc' },
    });
    const rows = invoices.map((inv) => {
      const sign = inv.txnType === 'CREDIT_NOTE' ? -1 : 1;
      const cost = sign * inv.lines.reduce((s, l) => s + num(l.costPrice) * num(l.quantity), 0);
      const revenue = sign * (num(inv.total) - num(inv.taxAmount));
      return {
        id: inv.id, txnNumber: inv.txnNumber, date: inv.date,
        party: inv.partyName ?? inv.party?.name ?? 'Cash Sale',
        total: sign * num(inv.total), revenue, cost, profit: revenue - cost,
      };
    });
    return { rows, totalProfit: rows.reduce((s, r) => s + r.profit, 0) };
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

  async partyWiseProfit(businessId: string, from?: string, to?: string, branchId?: string) {
    const invoices = await this.prisma.txn.findMany({
      where: this.txnWhere(businessId, ['SALE_INVOICE', 'CREDIT_NOTE'], from, to, branchId),
      include: { lines: true },
    });
    const byParty: Record<string, { party: string; sales: number; profit: number; count: number }> = {};
    for (const inv of invoices) {
      const key = inv.partyId ?? inv.partyName ?? 'Cash Sale';
      const name = inv.partyName ?? 'Cash Sale';
      if (!byParty[key]) byParty[key] = { party: name, sales: 0, profit: 0, count: 0 };
      const sign = inv.txnType === 'CREDIT_NOTE' ? -1 : 1;
      const cost = sign * inv.lines.reduce((s, l) => s + num(l.costPrice) * num(l.quantity), 0);
      byParty[key].sales += sign * num(inv.total);
      byParty[key].profit += sign * (num(inv.total) - num(inv.taxAmount)) - cost;
      byParty[key].count++;
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

  async itemWiseProfit(businessId: string, from?: string, to?: string, branchId?: string) {
    const lines = await this.prisma.txnLine.findMany({
      where: { txn: this.txnWhere(businessId, ['SALE_INVOICE', 'CREDIT_NOTE'], from, to, branchId) },
      include: { item: { select: { name: true, sku: true } }, txn: { select: { txnType: true } } },
    });
    const byItem: Record<string, { item: string; qty: number; revenue: number; cost: number; profit: number }> = {};
    for (const l of lines) {
      const key = l.itemId ?? l.name;
      const name = l.item?.name ?? l.name;
      if (!byItem[key]) byItem[key] = { item: name, qty: 0, revenue: 0, cost: 0, profit: 0 };
      const sign = l.txn.txnType === 'CREDIT_NOTE' ? -1 : 1;
      const revenue = sign * (num(l.total) - num(l.taxAmount));
      const cost = sign * num(l.costPrice) * num(l.quantity);
      byItem[key].qty += sign * num(l.quantity);
      byItem[key].revenue += revenue;
      byItem[key].cost += cost;
      byItem[key].profit += revenue - cost;
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

  async profitAndLoss(businessId: string, from?: string, to?: string, branchId?: string) {
    const [sales, saleReturns, purchases, purchaseReturns, expenses, saleLines, saleReturnLines, hotelRes] = await Promise.all([
      this.prisma.txn.aggregate({ where: this.txnWhere(businessId, 'SALE_INVOICE', from, to, branchId), _sum: { total: true, taxAmount: true } }),
      this.prisma.txn.aggregate({ where: this.txnWhere(businessId, 'CREDIT_NOTE', from, to, branchId), _sum: { total: true } }),
      this.prisma.txn.aggregate({ where: this.txnWhere(businessId, 'PURCHASE_BILL', from, to, branchId), _sum: { total: true, taxAmount: true } }),
      this.prisma.txn.aggregate({ where: this.txnWhere(businessId, 'DEBIT_NOTE', from, to, branchId), _sum: { total: true } }),
      this.prisma.txn.aggregate({ where: this.txnWhere(businessId, 'EXPENSE', from, to, branchId), _sum: { total: true } }),
      this.prisma.txnLine.findMany({ where: { txn: this.txnWhere(businessId, 'SALE_INVOICE', from, to, branchId) } }),
      this.prisma.txnLine.findMany({ where: { txn: this.txnWhere(businessId, 'CREDIT_NOTE', from, to, branchId) } }),
      // Hotel income: room revenue + folio/service charges for stays checked out in the period.
      // P&L holds zero hotel data otherwise, so this is double-count-safe.
      this.prisma.reservation.aggregate({
        where: {
          businessId,
          status: 'CHECKED_OUT',
          ...(branchId && { branchId }),
          ...(range(from, to) && { checkedOutAt: range(from, to) }),
        },
        _sum: { totalAmount: true, extraCharges: true },
      }),
    ]);

    const grossSale = num(sales._sum.total) - num(saleReturns._sum.total);
    const hotelRevenue = num(hotelRes._sum.totalAmount) + num(hotelRes._sum.extraCharges);
    const cogs = saleLines.reduce((s, l) => s + num(l.costPrice) * num(l.quantity), 0)
      - saleReturnLines.reduce((s, l) => s + num(l.costPrice) * num(l.quantity), 0);
    const grossProfit = grossSale - num(sales._sum.taxAmount) - cogs + hotelRevenue;
    const totalExpenses = num(expenses._sum.total);

    return {
      sale: num(sales._sum.total),
      saleReturns: num(saleReturns._sum.total),
      netSale: grossSale,
      hotelRevenue,
      totalRevenue: grossSale + hotelRevenue,
      purchase: num(purchases._sum.total),
      purchaseReturns: num(purchaseReturns._sum.total),
      cogs,
      grossProfit,
      expenses: totalExpenses,
      netProfit: grossProfit - totalExpenses,
      outputTax: num(sales._sum.taxAmount),
      inputTax: num(purchases._sum.taxAmount),
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
      stockValue = items.reduce((s, i) => s + num(i.currentStock) * num(i.purchasePrice || i.salePrice), 0);
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
    const pnl = await this.profitAndLoss(businessId, undefined, undefined, branchId);

    const cashBank = get('Cash & Bank').debit - get('Cash & Bank').credit;
    const receivable = get('Accounts Receivable').debit;
    const stock = get('Closing Stock').debit;
    const payable = get('Accounts Payable').credit;
    const loans = get('Loan Accounts').credit;

    // Hotel dues receivable: billed-but-uncollected balance on checked-out stays. P&L net
    // profit now includes accrued hotel revenue (R37); the collected part sits in Cash & Bank
    // (posted as PAYMENT_IN) and this receivable backs the uncollected part, so retained
    // earnings stays matched by real assets instead of a negative owner's-capital plug.
    const hotelStays = await this.prisma.reservation.findMany({
      where: { businessId, status: 'CHECKED_OUT', ...branchWhere(branchId) },
      select: { totalAmount: true, extraCharges: true, paidAmount: true },
    });
    const hotelReceivable = hotelStays.reduce(
      (s, r) => s + Math.max(0, num(r.totalAmount) + num(r.extraCharges) - num(r.paidAmount)),
      0,
    );

    const totalAssets = cashBank + receivable + stock + hotelReceivable;
    const totalLiabilities = payable + loans;
    const equity = totalAssets - totalLiabilities;

    return {
      assets: { cashAndBank: cashBank, receivables: receivable, hotelReceivable, closingStock: stock, total: totalAssets },
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

  // ─── Hotel report (PMS dashboard, kept from legacy platform) ──────────────

  async hotelReport(businessId: string, branchId?: string) {
    const roomWhere = { businessId, ...(branchId && { branchId }) };
    const resWhere = { businessId, ...(branchId && { branchId }) };

    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const yearStart = new Date(now.getFullYear(), 0, 1);

    const [rooms, reservations, folioPayments, expenses, completedServices] = await Promise.all([
      this.prisma.room.findMany({ where: roomWhere }),
      this.prisma.reservation.findMany({ where: resWhere }),
      this.prisma.folioPayment.findMany({
        where: { businessId, ...(branchId && { reservation: { branchId } }) },
      }),
      this.prisma.txn.findMany({ where: this.txnWhere(businessId, 'EXPENSE', undefined, undefined, branchId) }),
      this.prisma.serviceRequest.findMany({
        where: { businessId, status: 'COMPLETED', ...(branchId && { room: { branchId } }) },
        select: { amount: true, completedAt: true },
      }),
    ]);

    const totalRooms = rooms.length;
    const occupied = rooms.filter((r) => r.status === 'OCCUPIED').length;
    const reserved = rooms.filter((r) => r.status === 'RESERVED').length;
    const cleaning = rooms.filter((r) => r.status === 'CLEANING').length;
    const available = rooms.filter((r) => r.status === 'AVAILABLE').length;

    // Revenue is recognised on a BILLED basis — room + folio/service charges for stays
    // CHECKED OUT in the period (reservation.totalAmount + extraCharges), bucketed by
    // checkedOutAt. This matches the R37 P&L and shows revenue even when no folio payment
    // was explicitly recorded (the folioPayments-only basis showed zero in that case).
    const checkedOut = reservations.filter((r) => r.status === 'CHECKED_OUT' && r.checkedOutAt);
    const billedIn = (since?: Date) =>
      checkedOut
        .filter((r) => !since || (r.checkedOutAt && r.checkedOutAt >= since))
        .reduce((s, r) => s + num(r.totalAmount) + num(r.extraCharges), 0);
    const expensesIn = (since?: Date) =>
      expenses.filter((e) => !since || e.date >= since).reduce((s, e) => s + num(e.total), 0);

    const totalRevenue = billedIn();
    const todayRevenue = billedIn(todayStart);
    const monthRevenue = billedIn(monthStart);
    const yearRevenue = billedIn(yearStart);

    // Actual cash collected via folio payments (distinct from billed revenue above).
    const collected = folioPayments.reduce((s, p) => s + num(p.amount), 0);
    // Service income (completed service requests). Informational — the checked-out portion
    // is already inside extraCharges/totalRevenue, so this is NOT added into revenue/profit.
    const serviceRevenue = completedServices.reduce((s, sr) => s + num(sr.amount), 0);

    // Billed total incl. extra/service charges so pending reflects service money too.
    const totalBilled = reservations.reduce((s, r) => s + num(r.totalAmount) + num(r.extraCharges), 0);
    const totalCollected = reservations.reduce((s, r) => s + num(r.paidAmount), 0);

    return {
      totalRooms, occupied, reserved, cleaning, available,
      occupancyRate: totalRooms ? (occupied / totalRooms) * 100 : 0,
      utilizationRate: totalRooms ? ((occupied + reserved) / totalRooms) * 100 : 0,
      totalRevenue, todayRevenue, monthRevenue, yearRevenue,
      todayProfit: todayRevenue - expensesIn(todayStart),
      monthProfit: monthRevenue - expensesIn(monthStart),
      yearProfit: yearRevenue - expensesIn(yearStart),
      netProfit: totalRevenue - expensesIn(),
      collected,
      serviceRevenue,
      totalCollected,
      pendingAmount: Math.max(0, totalBilled - totalCollected),
      totalReservations: reservations.length,
    };
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
