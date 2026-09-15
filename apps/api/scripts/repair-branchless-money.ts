/**
 * Reveal money that is already in the books but branch-less — and therefore invisible.
 *
 * WHY
 * ---
 * Every screen and every report filters by branch (`branchWhere(branchId)`), but two writers
 * used to leave `branch_id` NULL:
 *
 *   1. signup created the business's "Cash in Hand" bank account with no branchId
 *      (auth.service.ts), while payment posting fell back to it business-wide. Real payments
 *      were debited into an account no page could open — 'unikid' sat at MINUS 52,000 there.
 *   2. POST /purchase/payments-out and POST /purchase/bills never injected the caller's branch,
 *      so those txns stored branch_id NULL and dropped out of every list and every report —
 *      'unikid' had 4 PAYMENT_OUT (85,000) and 6 PAYMENT_IN (19,500) rows in that state.
 *
 * Both writers are fixed in code. This script repairs the rows already written.
 *
 * WHAT IT DOES — and what it deliberately does NOT do
 * ---------------------------------------------------
 * It sets `branch_id` on rows that have none. That is all. It NEVER writes `balance`,
 * `opening_balance`, `total`, `paid_amount` or any other money column, never creates or deletes
 * a row, and never moves money between accounts. The money already moved; it was merely
 * invisible. This only reveals it.
 *
 * Expect the numbers ON SCREEN to change — that is the repair working. A shop whose Cash in Hand
 * showed 0 while a hidden account held -52,000 will, afterwards, show -52,000. Nothing was
 * deducted by this script; the deduction happened when the payments were made.
 *
 * It is idempotent: a repaired row no longer matches `branch_id IS NULL`, so a second run finds
 * nothing to do and reports identical before/after totals.
 *
 * USAGE
 * -----
 *   cd apps/api
 *   npx ts-node scripts/repair-branchless-money.ts                 # DRY RUN (default) — prints only
 *   npx ts-node scripts/repair-branchless-money.ts --apply         # actually writes
 *   npx ts-node scripts/repair-branchless-money.ts --business=<id> # limit to one business
 *
 * Dry run is the default on purpose: nothing is written unless --apply is passed.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Txn types whose branch_id we back-fill. Money movements that vanished from branch views. */
const ORPHAN_TXN_TYPES = ['PAYMENT_IN', 'PAYMENT_OUT', 'EXPENSE'] as const;

const APPLY = process.argv.includes('--apply');
const ONLY_BUSINESS = process.argv
  .find((a) => a.startsWith('--business='))
  ?.slice('--business='.length);

const money = (v: unknown) =>
  Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Totals = { perAccount: { id: string; name: string; branchId: string | null; balance: number }[]; sum: number };

/** The exact figure we promise not to change: every bank account balance in the business. */
async function balanceSnapshot(businessId: string): Promise<Totals> {
  const accounts = await prisma.bankAccount.findMany({
    where: { businessId },
    select: { id: true, name: true, branchId: true, balance: true },
    orderBy: [{ accountType: 'asc' }, { name: 'asc' }],
  });
  return {
    perAccount: accounts.map((a) => ({ id: a.id, name: a.name, branchId: a.branchId, balance: Number(a.balance) })),
    sum: accounts.reduce((s, a) => s + Number(a.balance), 0),
  };
}

/**
 * The shop a business calls home: its default branch, else its oldest surviving one. Matches
 * TxnCoreService.defaultBranchId, so repaired rows land where new ones now do.
 */
async function homeBranchId(businessId: string): Promise<string | null> {
  const home = await prisma.branch.findFirst({
    where: { businessId, isDefault: true, deletedAt: null },
    select: { id: true },
  });
  if (home) return home.id;
  const oldest = await prisma.branch.findFirst({
    where: { businessId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return oldest?.id ?? null;
}

async function repairBusiness(business: { id: string; name: string; slug: string }) {
  const before = await balanceSnapshot(business.id);

  const home = await homeBranchId(business.id);
  console.log(`\n${'═'.repeat(78)}`);
  console.log(`${business.name}  (${business.slug})`);
  console.log(`${'═'.repeat(78)}`);

  if (!home) {
    console.log('  ! No surviving branch — skipped. Create a shop first, then re-run.');
    return { accounts: 0, txns: 0, drift: 0 };
  }
  const homeBranch = await prisma.branch.findUnique({ where: { id: home }, select: { name: true } });

  // ── 1. Branch-less bank accounts → adopted by the home shop ───────────────
  const orphanAccounts = await prisma.bankAccount.findMany({
    where: { businessId: business.id, branchId: null },
    select: { id: true, name: true, accountType: true, balance: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`\n  Bank accounts with no shop: ${orphanAccounts.length}`);
  for (const a of orphanAccounts) {
    console.log(
      `    ${a.name} (${a.accountType})  balance ${money(a.balance)}` +
        `  →  ${homeBranch?.name ?? home}`,
    );
  }
  if (orphanAccounts.length) {
    const hidden = orphanAccounts.reduce((s, a) => s + Number(a.balance), 0);
    console.log(`    hidden balance revealed by this step: ${money(hidden)} (NOT a deduction — it is already in the ledger)`);
  }

  if (APPLY && orphanAccounts.length) {
    // branchId only. No money column appears in this update, by design.
    await prisma.bankAccount.updateMany({
      where: { businessId: business.id, branchId: null },
      data: { branchId: home },
    });
  }

  // ── 2. Branch-less PAYMENT_IN / PAYMENT_OUT / EXPENSE txns ────────────────
  // Each txn goes to the shop of the account its own payment actually hit — that keeps the
  // document in the same shop as the money it moved — and only falls back to the home shop when
  // the payment names no account (legacy rows) or that account is itself branch-less (in which
  // case step 1 just adopted it into the home shop anyway).
  const orphanTxns = await prisma.txn.findMany({
    where: { businessId: business.id, branchId: null, txnType: { in: [...ORPHAN_TXN_TYPES] } },
    select: {
      id: true,
      txnType: true,
      txnNumber: true,
      total: true,
      date: true,
      payments: { select: { bankAccount: { select: { id: true, name: true, branchId: true } } } },
    },
    orderBy: { date: 'asc' },
  });

  const branchNames = new Map<string, string>();
  const nameOf = async (id: string) => {
    if (!branchNames.has(id)) {
      const b = await prisma.branch.findUnique({ where: { id }, select: { name: true } });
      branchNames.set(id, b?.name ?? id);
    }
    return branchNames.get(id)!;
  };

  console.log(`\n  Transactions with no shop: ${orphanTxns.length}`);
  const byType: Record<string, { count: number; total: number }> = {};
  const plan: { id: string; branchId: string }[] = [];
  for (const t of orphanTxns) {
    const fromAccount = t.payments.map((p) => p.bankAccount).find((a) => a?.branchId)?.branchId;
    const target = fromAccount ?? home;
    plan.push({ id: t.id, branchId: target });
    byType[t.txnType] ??= { count: 0, total: 0 };
    byType[t.txnType].count++;
    byType[t.txnType].total += Number(t.total);
    console.log(
      `    ${t.txnType.padEnd(11)} ${String(t.txnNumber).padEnd(12)} ` +
        `${t.date.toISOString().slice(0, 10)}  ${money(t.total).padStart(12)}  →  ${await nameOf(target)}` +
        `${fromAccount ? ' (from its own payment account)' : ' (home shop)'}`,
    );
  }
  for (const [type, s] of Object.entries(byType)) {
    console.log(`    ${type}: ${s.count} rows, ${money(s.total)} — will become visible in lists and reports`);
  }

  if (APPLY) {
    // Grouped by target branch so this is a handful of updateMany calls, not one per row.
    const byBranch = new Map<string, string[]>();
    for (const row of plan) {
      if (!byBranch.has(row.branchId)) byBranch.set(row.branchId, []);
      byBranch.get(row.branchId)!.push(row.id);
    }
    for (const [branchId, ids] of byBranch) {
      // `branchId: null` stays in the WHERE so a concurrent/repeated run can never re-home a txn
      // that already has a shop.
      await prisma.txn.updateMany({ where: { id: { in: ids }, branchId: null }, data: { branchId } });
    }
  }

  // ── 3. Prove no balance moved ─────────────────────────────────────────────
  const after = await balanceSnapshot(business.id);
  const drift = Math.round((after.sum - before.sum) * 100) / 100;

  console.log('\n  Balances (must be identical before and after):');
  const afterById = new Map(after.perAccount.map((a) => [a.id, a]));
  for (const a of before.perAccount) {
    const b = afterById.get(a.id);
    const moved = b && Math.round((b.balance - a.balance) * 100) / 100 !== 0;
    console.log(
      `    ${a.name.padEnd(28)} before ${money(a.balance).padStart(12)}   after ${money(b?.balance ?? a.balance).padStart(12)}` +
        `${moved ? '   *** BALANCE CHANGED — THIS IS A BUG, INVESTIGATE ***' : ''}` +
        `${a.branchId === null && b?.branchId ? '   (adopted by a shop)' : ''}`,
    );
  }
  console.log(`    ${'TOTAL'.padEnd(28)} before ${money(before.sum).padStart(12)}   after ${money(after.sum).padStart(12)}`);
  if (drift !== 0) {
    console.log(`    *** TOTAL DRIFTED BY ${money(drift)} — this script must never do that. Investigate. ***`);
  }

  return { accounts: orphanAccounts.length, txns: orphanTxns.length, drift };
}

async function main() {
  console.log(APPLY ? '\n*** APPLY MODE — rows will be written ***' : '\n--- DRY RUN — nothing will be written (pass --apply to write) ---');

  const businesses = await prisma.business.findMany({
    where: ONLY_BUSINESS ? { OR: [{ id: ONLY_BUSINESS }, { slug: ONLY_BUSINESS }] } : {},
    select: { id: true, name: true, slug: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!businesses.length) {
    console.log('No businesses matched.');
    return;
  }

  let accounts = 0;
  let txns = 0;
  let drifted = 0;
  for (const b of businesses) {
    const r = await repairBusiness(b);
    accounts += r.accounts;
    txns += r.txns;
    if (r.drift !== 0) drifted++;
  }

  console.log(`\n${'═'.repeat(78)}`);
  console.log(
    `${APPLY ? 'Repaired' : 'Would repair'}: ${accounts} bank account(s), ${txns} transaction(s) ` +
      `across ${businesses.length} business(es).`,
  );
  if (drifted) console.log(`*** ${drifted} business(es) showed a balance drift — do NOT trust this run. ***`);
  if (!APPLY) console.log('Nothing was written. Re-run with --apply once the plan above looks right.');
  console.log(`${'═'.repeat(78)}\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
