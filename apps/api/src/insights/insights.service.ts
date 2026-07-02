import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DailyInsightDto } from './dto/push-insights.dto';

@Injectable()
export class InsightsService {
  constructor(private prisma: PrismaService) {}

  async pushInsights(
    businessId: string,
    branchId: string,
    deviceId: string,
    insights: DailyInsightDto[],
  ) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, businessId, deletedAt: null },
    });
    if (!branch) throw new ForbiddenException('Invalid branch for this business');

    let upserted = 0;
    for (const row of insights) {
      const date = new Date(row.date);
      date.setHours(0, 0, 0, 0);

      await this.prisma.shopDailyInsight.upsert({
        where: {
          branchId_deviceId_date: { branchId, deviceId, date },
        },
        create: {
          businessId,
          branchId,
          deviceId,
          date,
          salesRevenue: row.salesRevenue,
          purchaseTotal: row.purchaseTotal,
          expenseTotal: row.expenseTotal,
          invoiceCount: row.invoiceCount,
          taxCollected: row.taxCollected,
          profitEstimate: row.profitEstimate ?? null,
        },
        update: {
          salesRevenue: row.salesRevenue,
          purchaseTotal: row.purchaseTotal,
          expenseTotal: row.expenseTotal,
          invoiceCount: row.invoiceCount,
          taxCollected: row.taxCollected,
          profitEstimate: row.profitEstimate ?? null,
          syncedAt: new Date(),
        },
      });
      upserted++;
    }

    return { upserted };
  }

  /** Aggregate daily summaries from local transactions (for desktop → cloud sync). */
  async dailyLocal(businessId: string, branchId?: string): Promise<DailyInsightDto[]> {
    const num = (v: Prisma.Decimal | number | null | undefined) =>
      v == null ? 0 : Number(v);

    const sales = await this.prisma.txn.findMany({
      where: {
        businessId,
        deletedAt: null,
        status: { notIn: ['HELD', 'CANCELLED'] },
        txnType: 'SALE_INVOICE',
        ...(branchId ? { branchId } : {}),
      },
      select: { date: true, total: true, taxAmount: true },
    });

    const purchases = await this.prisma.txn.findMany({
      where: {
        businessId,
        deletedAt: null,
        status: { notIn: ['HELD', 'CANCELLED'] },
        txnType: 'PURCHASE_BILL',
        ...(branchId ? { branchId } : {}),
      },
      select: { date: true, total: true },
    });

    const expenses = await this.prisma.txn.findMany({
      where: {
        businessId,
        deletedAt: null,
        status: { notIn: ['HELD', 'CANCELLED'] },
        txnType: 'EXPENSE',
        ...(branchId ? { branchId } : {}),
      },
      select: { date: true, total: true },
    });

    const byDate = new Map<
      string,
      { salesRevenue: number; taxCollected: number; invoiceCount: number; purchaseTotal: number; expenseTotal: number }
    >();

    const key = (d: Date) => d.toISOString().slice(0, 10);
    const ensure = (k: string) => {
      if (!byDate.has(k)) {
        byDate.set(k, { salesRevenue: 0, taxCollected: 0, invoiceCount: 0, purchaseTotal: 0, expenseTotal: 0 });
      }
      return byDate.get(k)!;
    };

    for (const t of sales) {
      const row = ensure(key(t.date));
      row.salesRevenue += num(t.total);
      row.taxCollected += num(t.taxAmount);
      row.invoiceCount += 1;
    }
    for (const t of purchases) {
      ensure(key(t.date)).purchaseTotal += num(t.total);
    }
    for (const t of expenses) {
      ensure(key(t.date)).expenseTotal += num(t.total);
    }

    return [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, row]) => ({
        date,
        salesRevenue: row.salesRevenue,
        purchaseTotal: row.purchaseTotal,
        expenseTotal: row.expenseTotal,
        invoiceCount: row.invoiceCount,
        taxCollected: row.taxCollected,
        profitEstimate: Math.max(0, row.salesRevenue - row.purchaseTotal - row.expenseTotal) * 0.15,
      }));
  }

  async summary(businessId: string, branchId?: string) {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);

    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const yearStart = new Date(today.getFullYear(), 0, 1);

    const where: Prisma.ShopDailyInsightWhereInput = {
      businessId,
      ...(branchId ? { branchId } : {}),
    };

    const [todayRows, monthRows, yearRows, byBranch] = await Promise.all([
      this.prisma.shopDailyInsight.aggregate({
        where: { ...where, date: today },
        _sum: {
          salesRevenue: true,
          purchaseTotal: true,
          expenseTotal: true,
          taxCollected: true,
          profitEstimate: true,
          invoiceCount: true,
        },
      }),
      this.prisma.shopDailyInsight.aggregate({
        where: { ...where, date: { gte: monthStart } },
        _sum: {
          salesRevenue: true,
          purchaseTotal: true,
          expenseTotal: true,
          taxCollected: true,
          profitEstimate: true,
          invoiceCount: true,
        },
      }),
      this.prisma.shopDailyInsight.aggregate({
        where: { ...where, date: { gte: yearStart } },
        _sum: {
          salesRevenue: true,
          purchaseTotal: true,
          expenseTotal: true,
          taxCollected: true,
          profitEstimate: true,
          invoiceCount: true,
        },
      }),
      this.prisma.shopDailyInsight.groupBy({
        by: ['branchId'],
        where: { ...where, date: { gte: monthStart } },
        _sum: { salesRevenue: true, invoiceCount: true },
      }),
    ]);

    const branches = await this.prisma.branch.findMany({
      where: { businessId, deletedAt: null },
      select: { id: true, name: true, code: true },
    });
    const branchMap = new Map(branches.map((b) => [b.id, b]));

    const num = (v: Prisma.Decimal | number | null | undefined) =>
      v == null ? 0 : Number(v);

    return {
      today: {
        salesRevenue: num(todayRows._sum.salesRevenue),
        invoiceCount: todayRows._sum.invoiceCount ?? 0,
        taxCollected: num(todayRows._sum.taxCollected),
        profitEstimate: num(todayRows._sum.profitEstimate),
      },
      month: {
        salesRevenue: num(monthRows._sum.salesRevenue),
        invoiceCount: monthRows._sum.invoiceCount ?? 0,
        taxCollected: num(monthRows._sum.taxCollected),
        profitEstimate: num(monthRows._sum.profitEstimate),
      },
      year: {
        salesRevenue: num(yearRows._sum.salesRevenue),
        invoiceCount: yearRows._sum.invoiceCount ?? 0,
        taxCollected: num(yearRows._sum.taxCollected),
        profitEstimate: num(yearRows._sum.profitEstimate),
      },
      byBranch: byBranch.map((row: { branchId: string; _sum: { salesRevenue: Prisma.Decimal | null; invoiceCount: number | null } }) => ({
        branchId: row.branchId,
        branchName: branchMap.get(row.branchId)?.name ?? row.branchId,
        branchCode: branchMap.get(row.branchId)?.code,
        salesRevenue: num(row._sum.salesRevenue),
        invoiceCount: row._sum.invoiceCount ?? 0,
      })),
    };
  }
}
