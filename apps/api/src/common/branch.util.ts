import { Prisma } from '@prisma/client';

/** Filter Prisma queries to the active shop when branchId is set. */
export function branchWhere(branchId?: string | null) {
  return branchId ? { branchId } : {};
}

/** Unique key for per-shop transaction numbering sequences. */
export function txnSeqUnique(
  businessId: string,
  branchId: string,
  txnType: string,
): Prisma.TxnNumberSequenceWhereUniqueInput {
  return { businessId_branchId_txnType: { businessId, branchId, txnType } };
}
