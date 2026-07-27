import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { bootstrapShopDefaults } from './shop-setup.util';

@Injectable()
export class BranchesService {
  constructor(private prisma: PrismaService) {}

  findAll(businessId: string, type?: string) {
    const where: any = { businessId, deletedAt: null };
    if (type) {
      where.type = type;
    }
    return this.prisma.branch.findMany({
      where,
      orderBy: { name: 'asc' },
    });
  }

  async create(businessId: string, data: { name: string; code: string; address?: string; type?: string }) {
    // API is shop-only: every branch is created as type SHOP.
    const type = 'SHOP';
    if (!data.name?.trim()) throw new BadRequestException('Name is required');
    if (!data.code?.trim()) throw new BadRequestException('Code is required');

    return this.prisma.$transaction(async (tx) => {
      const branch = await tx.branch.create({
        data: { ...data, businessId, type },
      });

      await tx.warehouse.create({
        data: {
          businessId,
          branchId: branch.id,
          name: `${data.name} Store`,
          code: `WH-${data.code}`,
          address: data.address,
        },
      });

      await bootstrapShopDefaults(tx, businessId, branch.id, data.name);

      return branch;
    });
  }
  async getBranchMetrics(businessId: string, branchId: string) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [invoices, lowStockLevels] = await Promise.all([
      this.prisma.txn.findMany({
        where: {
          businessId,
          branchId,
          txnType: 'SALE_INVOICE',
          status: { notIn: ['HELD', 'CANCELLED'] },
          date: { gte: startOfDay },
          deletedAt: null,
        },
      }),
      this.prisma.stockLevel.findMany({
        where: {
          warehouse: { branchId },
          item: { businessId, trackStock: true, deletedAt: null },
        },
        select: { quantity: true, minStock: true },
      }),
    ]);

    const todaysSales = invoices.reduce((sum, t) => sum + Number(t.total), 0);
    const todaysOrders = invoices.length;
    const lowStockItems = lowStockLevels.filter(
      (l) => l.minStock !== null && Number(l.quantity) <= Number(l.minStock)
    ).length;

    return { todaysSales, todaysOrders, lowStockItems };
  }
}
