import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { branchWhere } from '../common/branch.util';
import { PrismaService } from '../prisma/prisma.service';

const num = (v: Prisma.Decimal | number | null | undefined) => Number(v ?? 0);

@Injectable()
export class UtilitiesService {
  constructor(private prisma: PrismaService) {}

  /**
   * Verify-my-data: recompute derived balances and report (and optionally fix) drift.
   */
  async verifyData(businessId: string, fix = false, branchId?: string) {
    const issues: { type: string; entity: string; expected: number; actual: number }[] = [];

    // Party balances: opening + sum of non-reversed effects should equal currentBalance.
    const parties = await this.prisma.party.findMany({ where: { businessId, deletedAt: null, ...branchWhere(branchId) } });
    for (const party of parties) {
      const ledgerSum = await this.prisma.partyLedgerEntry.aggregate({
        where: { businessId, partyId: party.id, ...branchWhere(branchId) },
        _sum: { amount: true },
      });
      const expected = num(ledgerSum._sum.amount);
      const actual = num(party.currentBalance);
      if (Math.abs(expected - actual) > 0.01) {
        issues.push({ type: 'PARTY_BALANCE', entity: party.name, expected, actual });
        if (fix) {
          await this.prisma.party.update({ where: { id: party.id }, data: { currentBalance: expected } });
        }
      }
    }

    // Item stock: stock level totals should equal currentStock.
    const items = await this.prisma.item.findMany({ where: { businessId, deletedAt: null, trackStock: true, ...branchWhere(branchId) } });
    for (const item of items) {
      const levels = await this.prisma.stockLevel.aggregate({
        where: { itemId: item.id, ...branchWhere(branchId) },
        _sum: { quantity: true },
      });
      const expected = num(levels._sum.quantity);
      const actual = num(item.currentStock);
      if (Math.abs(expected - actual) > 0.001) {
        issues.push({ type: 'ITEM_STOCK', entity: item.name, expected, actual });
        if (fix) {
          await this.prisma.item.update({ where: { id: item.id }, data: { currentStock: expected } });
        }
      }
    }

    // Txn balance integrity: paid + balance = total
    const txns = await this.prisma.txn.findMany({
      where: { businessId, deletedAt: null, txnType: { in: ['SALE_INVOICE', 'PURCHASE_BILL'] }, status: { not: 'HELD' }, ...branchWhere(branchId) },
    });
    for (const t of txns) {
      const expected = num(t.total);
      const actual = num(t.paidAmount) + num(t.balance);
      if (Math.abs(expected - actual) > 0.01) {
        issues.push({ type: 'TXN_BALANCE', entity: t.txnNumber, expected, actual });
        if (fix) {
          await this.prisma.txn.update({ where: { id: t.id }, data: { balance: new Prisma.Decimal(expected - num(t.paidAmount)) } });
        }
      }
    }

    return { issueCount: issues.length, fixed: fix, issues };
  }
}
