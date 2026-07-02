#!/usr/bin/env node
/**
 * Legacy → Vyapar data migration.
 *
 * The schema rewrite replaces Customer/Supplier with Party, Product with Item,
 * and Order/PurchaseBill/PaymentVoucher/Quotation/BusinessDocument/PurchaseOrder/Expense
 * with the unified Txn model. `prisma db push` drops the legacy tables, so this
 * runs in two phases:
 *
 *   1. node scripts/migrate-vyapar-data.mjs export   (BEFORE prisma db push)
 *      → snapshots legacy tables to scripts/.legacy-snapshot.json
 *   2. pnpm --filter @nexus/api exec prisma db push --accept-data-loss
 *   3. node scripts/migrate-vyapar-data.mjs import   (AFTER push + prisma generate)
 *      → maps the snapshot into the new Party/Item/Txn tables
 *
 * Fresh installs can skip this entirely and just seed.
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = path.join(__dirname, '.legacy-snapshot.json');
const require = createRequire(path.join(__dirname, '../apps/api/package.json'));
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const phase = process.argv[2];

const LEGACY_TABLES = [
  'customers', 'suppliers', 'products', 'product_variants',
  'orders', 'order_items', 'payments',
  'purchase_bills', 'purchase_bill_items',
  'payment_vouchers', 'quotations', 'quotation_items',
  'business_documents', 'business_document_items',
  'purchase_orders', 'purchase_order_items',
  'expenses', 'party_ledger_entries', 'payment_reminders', 'bank_accounts',
  'stock_levels', 'stock_movements',
];

async function tableExists(name) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`, name,
  );
  return rows.length > 0;
}

async function exportPhase() {
  const snapshot = {};
  for (const table of LEGACY_TABLES) {
    if (!(await tableExists(table))) continue;
    snapshot[table] = await prisma.$queryRawUnsafe(`SELECT * FROM "${table}"`);
    console.log(`exported ${table}: ${snapshot[table].length} rows`);
  }
  writeFileSync(SNAPSHOT, JSON.stringify(snapshot, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
  console.log(`\nSnapshot written to ${SNAPSHOT}`);
  console.log('Now run: pnpm --filter @nexus/api exec prisma db push --accept-data-loss');
  console.log('Then:    node scripts/migrate-vyapar-data.mjs import');
}

const num = (v) => (v == null ? 0 : Number(v));
const dateOr = (v, fallback = new Date()) => (v ? new Date(v) : fallback);

async function importPhase() {
  if (!existsSync(SNAPSHOT)) {
    console.error('No snapshot found. Run the export phase first (or skip migration for fresh installs).');
    process.exit(1);
  }
  const snap = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
  const get = (t) => snap[t] ?? [];

  // ── Parties: customers keep their ids; suppliers keep theirs ──
  const partyRows = [];
  for (const c of get('customers')) {
    partyRows.push({
      id: c.id, businessId: c.business_id, name: c.name, phone: c.phone, email: c.email,
      gstin: c.gst_number, billingAddress: c.address, partyType: 'CUSTOMER',
      currentBalance: num(c.outstanding_debt), loyaltyPoints: c.loyalty_points ?? 0,
      createdAt: dateOr(c.created_at),
    });
  }
  for (const s of get('suppliers')) {
    partyRows.push({
      id: s.id, businessId: s.business_id, name: s.name, phone: s.phone, email: s.email,
      gstin: s.gst_number, billingAddress: s.address, partyType: 'SUPPLIER',
      currentBalance: -num(s.outstanding_payable),
      createdAt: dateOr(s.created_at),
    });
  }
  if (partyRows.length) await prisma.party.createMany({ data: partyRows, skipDuplicates: true });
  // Opening ledger entries so migrated balances reconcile with the ledger
  const openingLedger = partyRows
    .filter((p) => Math.abs(p.currentBalance) > 0.005)
    .map((p) => ({
      businessId: p.businessId,
      partyId: p.id,
      entryType: 'OPENING',
      amount: p.currentBalance,
      balance: p.currentBalance,
      description: 'Opening balance (migrated)',
      entryDate: p.createdAt,
    }));
  if (openingLedger.length) await prisma.partyLedgerEntry.createMany({ data: openingLedger, skipDuplicates: true });
  console.log(`parties: ${partyRows.length} (+${openingLedger.length} opening ledger entries)`);

  // ── Items (from products) ──
  const itemRows = get('products').map((p) => ({
    id: p.id, businessId: p.business_id, categoryId: p.category_id,
    itemType: 'PRODUCT', name: p.name, sku: p.sku, barcode: p.barcode,
    hsnCode: p.hsn_code, description: p.description, imageUrl: p.image_url,
    salePrice: num(p.retail_price), purchasePrice: num(p.cost_price),
    wholesalePrice: p.wholesale_price != null ? num(p.wholesale_price) : null,
    mrp: p.mrp != null ? num(p.mrp) : null,
    taxRate: num(p.tax_rate), baseUnit: (p.unit || 'PCS').toUpperCase(),
    trackStock: p.track_stock ?? true, allowPriceEdit: p.allow_price_edit ?? true,
    isActive: p.is_active ?? true, createdAt: dateOr(p.created_at), deletedAt: p.deleted_at ? new Date(p.deleted_at) : null,
  }));
  if (itemRows.length) await prisma.item.createMany({ data: itemRows, skipDuplicates: true });
  const variantRows = get('product_variants').map((v) => ({
    id: v.id, itemId: v.product_id, name: v.name, sku: v.sku, barcode: v.barcode,
    price: num(v.price), attributes: v.attributes, isActive: v.is_active ?? true,
  }));
  if (variantRows.length) await prisma.itemVariant.createMany({ data: variantRows, skipDuplicates: true });
  console.log(`items: ${itemRows.length} (+${variantRows.length} variants)`);

  // ── Bank accounts (same table name; restore rows) ──
  const bankRows = get('bank_accounts').map((b) => ({
    id: b.id, businessId: b.business_id, name: b.name, accountType: b.account_type ?? 'CASH',
    accountNumber: b.account_number, bankName: b.bank_name, ifscCode: b.ifsc_code,
    balance: num(b.balance), isActive: b.is_active ?? true, createdAt: dateOr(b.created_at),
  }));
  if (bankRows.length) await prisma.bankAccount.createMany({ data: bankRows, skipDuplicates: true });

  // ── Txns ──
  const txns = [];
  const lines = [];
  const txnPayments = [];

  for (const o of get('orders')) {
    const isHeld = o.status === 'HELD';
    txns.push({
      id: o.id, businessId: o.business_id, branchId: o.branch_id, txnType: 'SALE_INVOICE',
      txnNumber: o.order_number, partyId: o.customer_id, date: dateOr(o.completed_at ?? o.created_at),
      subtotal: num(o.subtotal), discountAmount: num(o.discount_amount) + num(o.secondary_discount),
      discountPercent: o.discount_percent != null ? num(o.discount_percent) : null,
      taxAmount: num(o.tax_amount), total: num(o.total),
      paidAmount: o.status === 'COMPLETED' ? num(o.total) : 0,
      balance: o.status === 'COMPLETED' ? 0 : num(o.total),
      status: isHeld ? 'HELD' : o.status === 'REFUNDED' ? 'REFUNDED' : 'PAID',
      description: o.notes, createdById: o.cashier_id, clientId: o.client_id,
      syncedAt: o.synced_at ? new Date(o.synced_at) : null, heldAt: o.held_at ? new Date(o.held_at) : null,
      pointsEarned: o.points_earned ?? 0, pointsRedeemed: o.points_redeemed ?? 0,
      createdAt: dateOr(o.created_at), deletedAt: o.deleted_at ? new Date(o.deleted_at) : null,
    });
  }
  for (const i of get('order_items')) {
    lines.push({
      id: i.id, txnId: i.order_id, itemId: i.product_id, name: i.name,
      quantity: num(i.quantity), unitPrice: num(i.unit_price), costPrice: i.cost_price != null ? num(i.cost_price) : null,
      discountAmount: num(i.discount), taxRate: num(i.tax_rate), taxAmount: num(i.tax_amount), total: num(i.total),
    });
  }
  for (const p of get('payments')) {
    txnPayments.push({
      id: p.id, txnId: p.order_id, paymentType: p.method === 'BANK_TRANSFER' ? 'BANK' : p.method,
      amount: num(p.amount), referenceNo: p.reference, createdAt: dateOr(p.created_at),
    });
  }

  for (const b of get('purchase_bills')) {
    txns.push({
      id: b.id, businessId: b.business_id, branchId: b.branch_id, txnType: 'PURCHASE_BILL',
      txnNumber: b.bill_number, partyId: b.supplier_id, date: dateOr(b.bill_date),
      subtotal: num(b.subtotal), taxAmount: num(b.tax_amount), total: num(b.total),
      paidAmount: num(b.paid_amount), balance: num(b.total) - num(b.paid_amount),
      status: num(b.paid_amount) >= num(b.total) ? 'PAID' : num(b.paid_amount) > 0 ? 'PARTIAL' : 'OPEN',
      description: b.notes, createdAt: dateOr(b.created_at),
    });
  }
  for (const i of get('purchase_bill_items')) {
    lines.push({
      id: i.id, txnId: i.purchase_bill_id, itemId: i.product_id, name: i.name,
      quantity: num(i.quantity), unitPrice: num(i.unit_cost),
      taxRate: num(i.tax_rate), taxAmount: num(i.tax_amount), total: num(i.total),
    });
  }

  for (const v of get('payment_vouchers')) {
    txns.push({
      id: v.id, businessId: v.business_id, branchId: v.branch_id,
      txnType: v.type === 'PAYMENT_IN' ? 'PAYMENT_IN' : 'PAYMENT_OUT',
      txnNumber: v.voucher_number, partyId: v.customer_id ?? v.supplier_id,
      date: dateOr(v.voucher_date), total: num(v.amount), paidAmount: num(v.amount),
      status: 'PAID', description: v.notes, createdAt: dateOr(v.created_at),
    });
    txnPayments.push({
      txnId: v.id, paymentType: v.method ?? 'CASH', bankAccountId: v.bank_account_id,
      amount: num(v.amount), referenceNo: v.reference,
    });
  }

  for (const q of get('quotations')) {
    txns.push({
      id: q.id, businessId: q.business_id, branchId: q.branch_id, txnType: 'ESTIMATE',
      txnNumber: q.quote_number, partyId: q.customer_id, date: dateOr(q.created_at),
      dueDate: q.valid_until ? new Date(q.valid_until) : null,
      subtotal: num(q.subtotal), discountAmount: num(q.discount_amount), taxAmount: num(q.tax_amount),
      total: num(q.total), balance: num(q.total),
      status: q.status === 'CONVERTED' ? 'CONVERTED' : 'ORDER_OPEN',
      sourceTxnId: null, description: q.notes, createdAt: dateOr(q.created_at),
    });
  }
  for (const i of get('quotation_items')) {
    lines.push({
      id: i.id, txnId: i.quotation_id, itemId: i.product_id, name: i.name,
      quantity: num(i.quantity), unitPrice: num(i.unit_price),
      taxRate: num(i.tax_rate), taxAmount: num(i.tax_amount), total: num(i.total),
    });
  }

  const DOC_TYPE_MAP = {
    CREDIT_NOTE: 'CREDIT_NOTE', DEBIT_NOTE: 'DEBIT_NOTE',
    DELIVERY_CHALLAN: 'DELIVERY_CHALLAN', SALE_ORDER: 'SALE_ORDER',
  };
  for (const d of get('business_documents')) {
    txns.push({
      id: d.id, businessId: d.business_id, branchId: d.branch_id,
      txnType: DOC_TYPE_MAP[d.doc_type] ?? 'SALE_ORDER',
      txnNumber: d.doc_number, partyId: d.customer_id ?? d.supplier_id,
      date: dateOr(d.doc_date), subtotal: num(d.subtotal), taxAmount: num(d.tax_amount),
      total: num(d.total), balance: num(d.total), status: 'OPEN',
      description: d.notes, createdAt: dateOr(d.created_at),
    });
  }
  for (const i of get('business_document_items')) {
    lines.push({
      id: i.id, txnId: i.document_id, itemId: i.product_id, name: i.name,
      quantity: num(i.quantity), unitPrice: num(i.unit_price),
      taxRate: num(i.tax_rate), total: num(i.total),
    });
  }

  for (const po of get('purchase_orders')) {
    txns.push({
      id: po.id, businessId: po.business_id, txnType: 'PURCHASE_ORDER',
      txnNumber: po.po_number, partyId: po.supplier_id, date: dateOr(po.created_at),
      total: num(po.total), balance: num(po.total),
      status: po.status === 'DRAFT' ? 'ORDER_OPEN' : 'ORDER_CLOSED',
      description: po.notes, createdAt: dateOr(po.created_at),
    });
  }
  for (const i of get('purchase_order_items')) {
    lines.push({
      id: i.id, txnId: i.purchase_order_id, itemId: i.product_id, name: 'Item',
      quantity: num(i.quantity), unitPrice: num(i.unit_cost), total: num(i.total),
    });
  }

  for (const e of get('expenses')) {
    txns.push({
      id: e.id, businessId: e.business_id, branchId: e.branch_id, txnType: 'EXPENSE',
      txnNumber: `EXP-${e.id.slice(0, 8)}`, date: dateOr(e.expense_date),
      subtotal: num(e.amount), total: num(e.amount), paidAmount: e.status === 'PAID' ? num(e.amount) : 0,
      balance: e.status === 'PAID' ? 0 : num(e.amount),
      status: e.status === 'PAID' ? 'PAID' : 'OPEN',
      description: `${e.category}: ${e.description}`, createdAt: dateOr(e.created_at),
    });
  }

  if (txns.length) await prisma.txn.createMany({ data: txns, skipDuplicates: true });
  // Filter lines whose item no longer exists (defensive) and whose txn was inserted
  const txnIds = new Set(txns.map((t) => t.id));
  const itemIds = new Set(itemRows.map((i) => i.id));
  const safeLines = lines
    .filter((l) => txnIds.has(l.txnId))
    .map((l) => ({ ...l, itemId: l.itemId && itemIds.has(l.itemId) ? l.itemId : null }));
  if (safeLines.length) await prisma.txnLine.createMany({ data: safeLines, skipDuplicates: true });
  const safePayments = txnPayments.filter((p) => txnIds.has(p.txnId));
  if (safePayments.length) await prisma.txnPayment.createMany({ data: safePayments, skipDuplicates: true });
  console.log(`txns: ${txns.length}, lines: ${safeLines.length}, payments: ${safePayments.length}`);

  // ── Party ledger ──
  const partyIds = new Set(partyRows.map((p) => p.id));
  const ledgerRows = get('party_ledger_entries')
    .map((l) => ({
      id: l.id, businessId: l.business_id, branchId: l.branch_id,
      partyId: l.customer_id ?? l.supplier_id,
      txnId: l.reference_id && txnIds.has(l.reference_id) ? l.reference_id : null,
      entryType: l.entry_type,
      amount: ['SALE', 'PAYMENT_OUT', 'DEBIT_NOTE'].includes(l.entry_type) ? num(l.amount) : -num(l.amount),
      balance: num(l.balance), description: l.description, entryDate: dateOr(l.entry_date),
    }))
    .filter((l) => l.partyId && partyIds.has(l.partyId));
  if (ledgerRows.length) await prisma.partyLedgerEntry.createMany({ data: ledgerRows, skipDuplicates: true });

  // ── Payment reminders ──
  const reminderRows = get('payment_reminders')
    .map((r) => ({
      id: r.id, businessId: r.business_id, partyId: r.customer_id ?? r.supplier_id,
      amount: num(r.amount), dueDate: dateOr(r.due_date), status: r.status ?? 'PENDING',
      channel: r.channel ?? 'SMS', message: r.message,
      sentAt: r.sent_at ? new Date(r.sent_at) : null,
    }))
    .filter((r) => !r.partyId || partyIds.has(r.partyId));
  if (reminderRows.length) await prisma.paymentReminder.createMany({ data: reminderRows, skipDuplicates: true });

  // ── Stock levels & movements (product_id → item_id) ──
  const stockLevelRows = get('stock_levels')
    .filter((s) => itemIds.has(s.product_id))
    .map((s) => ({
      id: s.id, itemId: s.product_id, warehouseId: s.warehouse_id, branchId: s.branch_id,
      quantity: num(s.quantity), reserved: num(s.reserved),
      minStock: s.min_stock != null ? num(s.min_stock) : null,
      batchNumber: s.batch_number, expiryDate: s.expiry_date ? new Date(s.expiry_date) : null,
    }));
  if (stockLevelRows.length) await prisma.stockLevel.createMany({ data: stockLevelRows, skipDuplicates: true });
  const movementRows = get('stock_movements')
    .filter((m) => itemIds.has(m.product_id))
    .map((m) => ({
      id: m.id, businessId: m.business_id, itemId: m.product_id, warehouseId: m.warehouse_id,
      branchId: m.branch_id, type: m.type, quantity: num(m.quantity),
      reference: m.reference, notes: m.notes, createdAt: dateOr(m.created_at),
    }));
  if (movementRows.length) await prisma.stockMovement.createMany({ data: movementRows, skipDuplicates: true });

  // Denormalized current stock per item
  const stockTotals = await prisma.stockLevel.groupBy({ by: ['itemId'], _sum: { quantity: true } }).catch(() => []);
  for (const s of stockTotals) {
    await prisma.item.update({ where: { id: s.itemId }, data: { currentStock: s._sum.quantity ?? 0 } }).catch(() => {});
  }

  console.log('\nMigration import complete.');
}

(phase === 'export' ? exportPhase() : phase === 'import' ? importPhase() : Promise.reject(new Error('Usage: migrate-vyapar-data.mjs <export|import>')))
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
