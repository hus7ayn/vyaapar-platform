import { Prisma } from '@prisma/client';
import { DEFAULT_PREFIXES, TXN_TYPES } from '../txns/txn.constants';

type TxClient = Prisma.TransactionClient;

const DEFAULT_EXPENSE_CATEGORIES = [
  { name: 'Rent', isGst: false },
  { name: 'Salary', isGst: false },
  { name: 'Electricity', isGst: false },
  { name: 'Telephone & Internet', isGst: true },
  { name: 'Transport', isGst: true },
  { name: 'Repair & Maintenance', isGst: true },
  { name: 'Office Supplies', isGst: true },
  { name: 'Tea & Refreshments', isGst: false },
  { name: 'Marketing', isGst: true },
  { name: 'Miscellaneous', isGst: false },
];

const DEFAULT_ITEM_CATEGORIES = [
  'Beverages', 'Snacks', 'Grocery', 'Electronics', 'General',
];

/** Seed isolated defaults when a new shop/branch is created. */
export async function bootstrapShopDefaults(
  tx: TxClient,
  businessId: string,
  branchId: string,
  branchName: string,
) {
  const cash = await tx.bankAccount.findFirst({
    where: { businessId, branchId, accountType: 'CASH' },
  });
  if (!cash) {
    await tx.bankAccount.create({
      data: {
        businessId,
        branchId,
        name: `${branchName} Cash`,
        accountType: 'CASH',
        openingBalance: 0,
        balance: 0,
      },
    });
  }

  for (const c of DEFAULT_EXPENSE_CATEGORIES) {
    await tx.expenseCategory.upsert({
      where: { businessId_branchId_name: { businessId, branchId, name: c.name } },
      create: { businessId, branchId, ...c },
      update: {},
    });
  }

  for (let i = 0; i < DEFAULT_ITEM_CATEGORIES.length; i++) {
    const name = DEFAULT_ITEM_CATEGORIES[i];
    const slug = name.toLowerCase().replace(/\s+/g, '-');
    await tx.category.upsert({
      where: { businessId_branchId_slug: { businessId, branchId, slug } },
      create: { businessId, branchId, name, slug, sortOrder: i },
      update: {},
    });
  }

  for (const txnType of TXN_TYPES) {
    await tx.txnNumberSequence.upsert({
      where: { businessId_branchId_txnType: { businessId, branchId, txnType } },
      create: { businessId, branchId, txnType, prefix: DEFAULT_PREFIXES[txnType], nextNumber: 1 },
      update: {},
    });
  }
}
