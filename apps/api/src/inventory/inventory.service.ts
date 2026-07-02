import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}

  async getWarehouses(businessId: string) {
    return this.prisma.warehouse.findMany({
      where: { businessId },
      orderBy: { name: 'asc' },
    });
  }

  async getStockLevels(businessId: string, branchId?: string) {
    return this.prisma.stockLevel.findMany({
      where: {
        item: { businessId },
        ...(branchId ? { warehouse: { branchId } } : {}),
      },
      include: { item: true, warehouse: true, branch: true },
    });
  }

  async adjustStock(
    businessId: string,
    data: { itemId: string; warehouseId: string; branchId?: string; quantity: number; notes?: string },
  ) {
    const stock = await this.prisma.stockLevel.findFirst({
      where: { itemId: data.itemId, warehouseId: data.warehouseId },
    });

    if (stock) {
      await this.prisma.stockLevel.update({
        where: { id: stock.id },
        data: { quantity: { increment: data.quantity } },
      });
    } else {
      await this.prisma.stockLevel.create({
        data: {
          itemId: data.itemId,
          warehouseId: data.warehouseId,
          branchId: data.branchId,
          quantity: data.quantity,
        },
      });
    }

    await this.prisma.item.update({
      where: { id: data.itemId },
      data: { currentStock: { increment: data.quantity } },
    });

    return this.prisma.stockMovement.create({
      data: {
        businessId,
        itemId: data.itemId,
        warehouseId: data.warehouseId,
        branchId: data.branchId,
        type: 'ADJUSTMENT',
        quantity: data.quantity,
        notes: data.notes,
      },
    });
  }

  async transferStock(
    businessId: string,
    data: {
      itemId: string;
      fromWarehouseId: string;
      toWarehouseId: string;
      quantity: number;
    },
  ) {
    const from = await this.prisma.stockLevel.findFirst({
      where: { itemId: data.itemId, warehouseId: data.fromWarehouseId },
    });
    if (!from || from.quantity.lt(data.quantity)) {
      throw new BadRequestException('Insufficient stock at source warehouse');
    }

    const to = await this.prisma.stockLevel.findFirst({
      where: { itemId: data.itemId, warehouseId: data.toWarehouseId },
    });

    await this.prisma.$transaction([
      this.prisma.stockLevel.update({
        where: { id: from.id },
        data: { quantity: from.quantity.sub(data.quantity) },
      }),
      to
        ? this.prisma.stockLevel.update({
            where: { id: to.id },
            data: { quantity: to.quantity.add(data.quantity) },
          })
        : this.prisma.stockLevel.create({
            data: {
              itemId: data.itemId,
              warehouseId: data.toWarehouseId,
              quantity: data.quantity,
            },
          }),
      this.prisma.stockMovement.create({
        data: {
          businessId,
          itemId: data.itemId,
          warehouseId: data.fromWarehouseId,
          type: 'TRANSFER_OUT',
          quantity: -data.quantity,
          reference: `to:${data.toWarehouseId}`,
        },
      }),
      this.prisma.stockMovement.create({
        data: {
          businessId,
          itemId: data.itemId,
          warehouseId: data.toWarehouseId,
          type: 'TRANSFER_IN',
          quantity: data.quantity,
          reference: `from:${data.fromWarehouseId}`,
        },
      }),
    ]);

    return { success: true };
  }

  async getLowStock(businessId: string, branchId?: string) {
    const levels = await this.prisma.stockLevel.findMany({
      where: {
        item: { businessId, trackStock: true },
        ...(branchId ? { warehouse: { branchId } } : {}),
      },
      include: { item: true, warehouse: true },
    });
    return levels.filter((l) => l.minStock && l.quantity.lte(l.minStock));
  }

  async updateThreshold(stockLevelId: string, minStock: number) {
    return this.prisma.stockLevel.update({
      where: { id: stockLevelId },
      data: { minStock },
    });
  }
}
