#!/usr/bin/env node
/**
 * End-to-end smoke test for the Vyapar-parity platform.
 * Exercises the full transaction lifecycle:
 * party → item → estimate → convert → invoice → payment-in (bill-wise) →
 * credit note → purchase order → receive → bill → payment-out → reports.
 *
 * Run: node scripts/e2e-smoke.mjs  (API at localhost:4000, seeded DB)
 */
const API = process.env.API_URL || 'http://localhost:4000/api/v1';

async function req(path, { method = 'GET', token, branchId, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(branchId ? { 'x-branch-id': branchId } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${data?.message || text}`);
  return data;
}

const approx = (a, b, msg) => {
  if (Math.abs(Number(a) - Number(b)) > 0.01) throw new Error(`${msg}: expected ${b}, got ${a}`);
};

async function main() {
  console.log('🔍 Vyapar-Parity E2E Smoke Test\n');

  const login = await req('/auth/login', {
    method: 'POST',
    body: { email: 'admin@grandplaza.demo', password: 'Demo@123456' },
  });
  const token = login.accessToken;
  console.log('✅ Login');

  const branches = await req('/branches?type=SHOP', { token: login.accessToken });
  if (!branches?.length) throw new Error('No SHOP branches — run seed');
  const branchId = branches.find((b) => b.isDefault)?.id ?? branches[0].id;
  const hdr = { token, branchId };

  await req('/reports/dashboard', hdr);
  console.log('✅ Dashboard');

  // ── Party ──
  const stamp = Date.now().toString(36);
  const party = await req('/parties', {
    method: 'POST',
    ...hdr,
    body: { name: `Smoke Traders ${stamp}`, partyType: 'BOTH', gstin: '27SMOKE1234A1Z1', openingBalance: 0 },
  });
  console.log('✅ Party created:', party.name);

  // ── Item ──
  const item = await req('/items', {
    method: 'POST',
    ...hdr,
    body: { name: `Smoke Widget ${stamp}`, salePrice: 100, purchasePrice: 60, taxRate: 18, baseUnit: 'PCS', openingStock: 50, minStock: 5, hsnCode: '8479' },
  });
  console.log('✅ Item created:', item.name, '(opening stock 50)');

  // ── Estimate → convert to invoice ──
  const estimate = await req('/sale/estimates', {
    method: 'POST',
    ...hdr,
    body: { branchId, partyId: party.id, lines: [{ itemId: item.id, quantity: 2 }] },
  });
  console.log('✅ Estimate:', estimate.txnNumber);

  const fromEstimate = await req(`/sale/estimates/${estimate.id}/convert`, { method: 'POST', ...hdr, body: {} });
  console.log('✅ Estimate converted →', fromEstimate.txnNumber);

  // ── Credit sale invoice (DEBT) ──
  const invoice = await req('/sale/invoices', {
    method: 'POST',
    ...hdr,
    body: {
      branchId,
      partyId: party.id,
      lines: [{ itemId: item.id, quantity: 5, unitPrice: 100 }],
      payments: [{ paymentType: 'CASH', amount: 200 }, { paymentType: 'DEBT', amount: 390 }],
    },
  });
  approx(invoice.total, 590, 'invoice total (500 + 18% tax)');
  approx(invoice.balance, 390, 'invoice balance');
  console.log('✅ Sale invoice:', invoice.txnNumber, '| total 590, balance 390');

  let p = await req(`/parties/${party.id}`, hdr);
  if (Number(p.currentBalance) < 389) throw new Error('Party receivable not updated');
  console.log('✅ Party receivable:', Number(p.currentBalance).toFixed(2));

  // ── Payment-in with bill-wise auto-allocation (FIFO across open invoices) ──
  const paymentIn = await req('/sale/payments-in', {
    method: 'POST',
    ...hdr,
    body: { branchId, partyId: party.id, amount: Number(p.currentBalance) },
  });
  console.log('✅ Payment In:', paymentIn.txnNumber, `(${Number(p.currentBalance).toFixed(2)} auto-allocated FIFO)`);

  const invAfter = await req(`/txns/${invoice.id}`, hdr);
  if (invAfter.status !== 'PAID') throw new Error(`Invoice should be PAID after allocation, got ${invAfter.status}`);
  p = await req(`/parties/${party.id}`, hdr);
  approx(p.currentBalance, 0, 'party balance after settling all bills');
  console.log('✅ Bill-wise allocation: all invoices PAID, party settled');

  // ── Credit note (sale return) ──
  const creditNote = await req('/sale/credit-notes', {
    method: 'POST',
    ...hdr,
    body: {
      branchId,
      partyId: party.id,
      returnAgainstTxnId: invoice.id,
      lines: [{ itemId: item.id, quantity: 1, unitPrice: 100 }],
      payments: [{ paymentType: 'CASH', amount: 118 }],
    },
  });
  console.log('✅ Credit note:', creditNote.txnNumber);

  // ── Purchase order → receive → bill ──
  const po = await req('/purchase/orders', {
    method: 'POST',
    ...hdr,
    body: { branchId, partyId: party.id, lines: [{ itemId: item.id, quantity: 10, unitPrice: 60 }] },
  });
  console.log('✅ Purchase order:', po.txnNumber);

  const bill = await req(`/purchase/orders/${po.id}/receive`, { method: 'POST', ...hdr, body: {} });
  console.log('✅ PO received → bill:', bill.txnNumber);

  // ── Payment out ──
  const paymentOut = await req('/purchase/payments-out', {
    method: 'POST',
    ...hdr,
    body: { branchId, partyId: party.id, amount: Number(bill.total) },
  });
  console.log('✅ Payment Out:', paymentOut.txnNumber);

  // ── Stock check: 50 - 2 (est conv) - 5 (sale) + 1 (return) + 10 (purchase) = 54 ──
  const itemAfter = await req(`/items/${item.id}`, hdr);
  approx(itemAfter.currentStock, 54, 'item stock after lifecycle');
  console.log('✅ Stock correct:', Number(itemAfter.currentStock));

  // ── Expense ──
  const cats = await req('/expenses/categories', hdr);
  await req('/expenses', {
    method: 'POST',
    ...hdr,
    body: { branchId, expenseCategoryId: cats[0].id, amount: 250, description: 'Smoke expense' },
  });
  console.log('✅ Expense recorded');

  // ── Cash & Bank ──
  const cb = await req('/cash-bank/summary', hdr);
  console.log('✅ Cash & Bank summary | cash:', cb.cashBalance.toFixed(2));

  // ── Reports ──
  const from = new Date(); from.setDate(1);
  const fromStr = from.toISOString().slice(0, 10);
  const toStr = new Date().toISOString().slice(0, 10);
  for (const path of [
    `/reports/sale?from=${fromStr}&to=${toStr}`,
    `/reports/purchase?from=${fromStr}&to=${toStr}`,
    `/reports/day-book?date=${toStr}`,
    `/reports/cash-flow?from=${fromStr}&to=${toStr}`,
    `/reports/bill-wise-profit?from=${fromStr}&to=${toStr}`,
    `/reports/pnl?from=${fromStr}&to=${toStr}`,
    '/reports/trial-balance',
    '/reports/balance-sheet',
    `/reports/gstr1?from=${fromStr}&to=${toStr}`,
    `/reports/gstr3b?from=${fromStr}&to=${toStr}`,
    `/reports/hsn-summary?from=${fromStr}&to=${toStr}`,
    '/reports/stock-summary',
    '/reports/all-parties',
    `/parties/${party.id}/ledger`,
  ]) {
    await req(path, hdr);
  }
  console.log('✅ Reports: sale, purchase, day-book, cash-flow, bill-wise profit, P&L, trial balance, balance sheet, GSTR-1/3B, HSN, stock, parties, ledger');

  // ── Verify data integrity ──
  const verify = await req('/utilities/verify-data', { method: 'POST', ...hdr });
  if (verify.issueCount > 0) {
    console.warn('⚠️  Data verify found issues:', JSON.stringify(verify.issues.slice(0, 5)));
  } else {
    console.log('✅ Verify-my-data: no drift');
  }

  // ── Delete reverses effects ──
  await req(`/txns/${creditNote.id}`, { method: 'DELETE', ...hdr });
  const itemFinal = await req(`/items/${item.id}`, hdr);
  approx(itemFinal.currentStock, 53, 'stock after deleting credit note (reverses +1)');
  console.log('✅ Recycle bin delete reversed stock effect');

  console.log('\n🎉 All smoke tests passed!');
}

main().catch((e) => {
  console.error('\n❌', e.message);
  process.exit(1);
});
