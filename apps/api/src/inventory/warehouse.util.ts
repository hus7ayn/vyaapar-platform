import { Prisma } from '@prisma/client';

type TxClient = Prisma.TransactionClient;

export async function resolveBranchWarehouse(tx: TxClient, businessId: string, branchId: string) {
  const byBranch = await tx.warehouse.findFirst({ where: { branchId, businessId } });
  if (byBranch) return byBranch;

  const fallback = await tx.warehouse.findFirst({ where: { businessId }, orderBy: { createdAt: 'asc' } });
  if (!fallback) return null;

  if (!fallback.branchId) {
    return tx.warehouse.update({
      where: { id: fallback.id },
      data: { branchId },
    });
  }

  return tx.warehouse.create({
    data: {
      businessId,
      branchId,
      name: 'Store Warehouse',
      code: `WH-${branchId.slice(0, 8).toUpperCase()}`,
    },
  });
}
