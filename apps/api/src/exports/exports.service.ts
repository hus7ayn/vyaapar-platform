import { Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ExportsService {
  constructor(private prisma: PrismaService) {}

  private toBuffer(data: Record<string, unknown>[], sheetName: string): Buffer {
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  }

  private toCsv(data: Record<string, unknown>[]): string {
    const ws = XLSX.utils.json_to_sheet(data);
    return XLSX.utils.sheet_to_csv(ws);
  }

  private pack(rows: Record<string, unknown>[], sheet: string, format: 'xlsx' | 'csv') {
    if (format === 'csv') return { content: this.toCsv(rows), mime: 'text/csv', ext: 'csv' };
    return { content: this.toBuffer(rows, sheet), mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' };
  }

  private dateRange(from?: string, to?: string) {
    if (!from && !to) return undefined;
    const r: { gte?: Date; lte?: Date } = {};
    if (from) r.gte = new Date(from);
    if (to) { const d = new Date(to); d.setHours(23, 59, 59, 999); r.lte = d; }
    return r;
  }

  /** Generic transaction export for any txn type. */
  async exportTxns(businessId: string, txnType: string, from: string | undefined, to: string | undefined, format: 'xlsx' | 'csv') {
    const txns = await this.prisma.txn.findMany({
      where: {
        businessId,
        deletedAt: null,
        status: { not: 'HELD' },
        ...(txnType !== 'ALL' && { txnType: { in: txnType.split(',') } }),
        ...(this.dateRange(from, to) && { date: this.dateRange(from, to) }),
      },
      include: { lines: true, party: { select: { name: true, gstin: true } } },
      orderBy: { date: 'desc' },
    });
    const rows = txns.map((t) => ({
      type: t.txnType,
      number: t.txnNumber,
      date: t.date.toISOString().slice(0, 10),
      party: t.partyName ?? t.party?.name ?? '',
      gstin: t.party?.gstin ?? '',
      subtotal: Number(t.subtotal),
      discount: Number(t.discountAmount),
      tax: Number(t.taxAmount),
      total: Number(t.total),
      paid: Number(t.paidAmount),
      balance: Number(t.balance),
      status: t.status,
      items: t.lines.length,
    }));
    return this.pack(rows, txnType === 'ALL' ? 'Transactions' : txnType, format);
  }

  async exportSales(businessId: string, from: string, to: string, format: 'xlsx' | 'csv') {
    return this.exportTxns(businessId, 'SALE_INVOICE', from, to, format);
  }

  async exportParties(businessId: string, format: 'xlsx' | 'csv') {
    const parties = await this.prisma.party.findMany({ where: { businessId, deletedAt: null }, orderBy: { name: 'asc' } });
    const rows = parties.map((p) => ({
      name: p.name,
      phone: p.phone ?? '',
      email: p.email ?? '',
      gstin: p.gstin ?? '',
      type: p.partyType,
      receivable: Number(p.currentBalance) > 0 ? Number(p.currentBalance) : 0,
      payable: Number(p.currentBalance) < 0 ? -Number(p.currentBalance) : 0,
    }));
    return this.pack(rows, 'Parties', format);
  }

  async exportItems(businessId: string, format: 'xlsx' | 'csv') {
    const items = await this.prisma.item.findMany({
      where: { businessId, deletedAt: null },
      include: { category: true },
      orderBy: { name: 'asc' },
    });
    const rows = items.map((i) => ({
      name: i.name,
      code: i.sku,
      barcode: i.barcode ?? '',
      hsn: i.hsnCode ?? '',
      category: i.category?.name ?? '',
      type: i.itemType,
      salePrice: Number(i.salePrice),
      purchasePrice: Number(i.purchasePrice),
      taxRate: Number(i.taxRate),
      unit: i.baseUnit,
      stock: Number(i.currentStock),
      minStock: i.minStock != null ? Number(i.minStock) : '',
      stockValue: Number(i.currentStock) * Number(i.purchasePrice || i.salePrice),
    }));
    return this.pack(rows, 'Items', format);
  }

  async exportInventory(businessId: string, format: 'xlsx' | 'csv') {
    return this.exportItems(businessId, format);
  }

  async exportPayroll(businessId: string, format: 'xlsx' | 'csv') {
    const payrolls = await this.prisma.payroll.findMany({
      where: { businessId },
      include: { lines: { include: { employee: true } } },
    });
    const rows = payrolls.flatMap((p) =>
      p.lines.map((l) => ({
        period: p.period,
        employee: `${l.employee.firstName} ${l.employee.lastName}`,
        baseSalary: Number(l.baseSalary),
        netSalary: Number(l.netSalary),
        status: p.status,
      })),
    );
    return this.pack(rows, 'Payroll', format);
  }

  async exportExpenses(businessId: string, format: 'xlsx' | 'csv') {
    const expenses = await this.prisma.txn.findMany({
      where: { businessId, txnType: 'EXPENSE', deletedAt: null },
      include: { expenseCategory: true },
      orderBy: { date: 'desc' },
    });
    const rows = expenses.map((e) => ({
      number: e.txnNumber,
      date: e.date.toISOString().slice(0, 10),
      category: e.expenseCategory?.name ?? '',
      amount: Number(e.total),
      description: e.description ?? '',
      status: e.status,
    }));
    return this.pack(rows, 'Expenses', format);
  }

  /** GSTR-1 JSON-style export for filing assistance. */
  async exportGstr1Json(businessId: string, from?: string, to?: string) {
    const txns = await this.prisma.txn.findMany({
      where: {
        businessId, deletedAt: null, status: { not: 'HELD' },
        txnType: { in: ['SALE_INVOICE', 'CREDIT_NOTE'] },
        ...(this.dateRange(from, to) && { date: this.dateRange(from, to) }),
      },
      include: { lines: true, party: { select: { name: true, gstin: true, state: true } } },
    });
    const business = await this.prisma.business.findUnique({ where: { id: businessId } });
    return {
      gstin: business?.gstNumber ?? null,
      fp: from ? `${new Date(from).getMonth() + 1}${new Date(from).getFullYear()}` : null,
      b2b: txns.filter((t) => t.party?.gstin).map((t) => ({
        ctin: t.party!.gstin,
        inv: [{
          inum: t.txnNumber,
          idt: t.date.toISOString().slice(0, 10),
          val: Number(t.total),
          itms: t.lines.map((l, i) => ({
            num: i + 1,
            itm_det: { txval: Number(l.total) - Number(l.taxAmount), rt: Number(l.taxRate), camt: Number(l.taxAmount) / 2, samt: Number(l.taxAmount) / 2 },
          })),
        }],
      })),
      b2cs: txns.filter((t) => !t.party?.gstin).map((t) => ({
        typ: 'OE',
        txval: Number(t.total) - Number(t.taxAmount),
        rt: t.lines.length ? Number(t.lines[0].taxRate) : 0,
        camt: Number(t.taxAmount) / 2,
        samt: Number(t.taxAmount) / 2,
      })),
    };
  }
}
