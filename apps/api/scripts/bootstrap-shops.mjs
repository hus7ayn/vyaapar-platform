/**
 * Bootstrap per-shop defaults for all existing SHOP branches.
 * Run: pnpm --filter @nexus/api exec node scripts/bootstrap-shops.mjs
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

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

const DEFAULT_ITEM_CATEGORIES = ['Beverages', 'Snacks', 'Grocery', 'Electronics', 'General'];

const DEFAULT_PREFIXES = {
  SALE_INVOICE: 'SI', CREDIT_NOTE: 'CN', SALE_ORDER: 'SO', DELIVERY_CHALLAN: 'DC',
  ESTIMATE: 'EST', PAYMENT_IN: 'PI', PURCHASE_BILL: 'PB', DEBIT_NOTE: 'DN',
  PURCHASE_ORDER: 'PO', PAYMENT_OUT: 'POUT', EXPENSE: 'EXP', P2P_TRANSFER: 'P2P',
};

const TXN_TYPES = Object.keys(DEFAULT_PREFIXES);

async function bootstrapShop(businessId, branchId, branchName) {
  const cash = await prisma.bankAccount.findFirst({ where: { businessId, branchId, accountType: 'CASH' } });
  if (!cash) {
    await prisma.bankAccount.create({
      data: { businessId, branchId, name: `${branchName} Cash`, accountType: 'CASH', openingBalance: 0, balance: 0 },
    });
    console.log(`  + cash account for ${branchName}`);
  }

  for (const c of DEFAULT_EXPENSE_CATEGORIES) {
    await prisma.expenseCategory.upsert({
      where: { businessId_branchId_name: { businessId, branchId, name: c.name } },
      create: { businessId, branchId, ...c },
      update: {},
    });
  }

  for (let i = 0; i < DEFAULT_ITEM_CATEGORIES.length; i++) {
    const name = DEFAULT_ITEM_CATEGORIES[i];
    const slug = name.toLowerCase().replace(/\s+/g, '-');
    await prisma.category.upsert({
      where: { businessId_branchId_slug: { businessId, branchId, slug } },
      create: { businessId, branchId, name, slug, sortOrder: i },
      update: {},
    });
  }

  for (const txnType of TXN_TYPES) {
    await prisma.txnNumberSequence.upsert({
      where: { businessId_branchId_txnType: { businessId, branchId, txnType } },
      create: { businessId, branchId, txnType, prefix: DEFAULT_PREFIXES[txnType], nextNumber: 1 },
      update: {},
    });
  }
}

async function main() {
  const shops = await prisma.branch.findMany({
    where: { type: 'SHOP', deletedAt: null, isActive: true },
    select: { id: true, businessId: true, name: true },
  });
  console.log(`Bootstrapping ${shops.length} shop(s)...`);
  for (const shop of shops) {
    console.log(`Shop: ${shop.name} (${shop.id})`);
    await bootstrapShop(shop.businessId, shop.id, shop.name);
  }
  console.log('Done.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
