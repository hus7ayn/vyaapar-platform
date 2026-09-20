/**
 * Mint the FIRST owner account on a brand-new, empty database — and nothing else.
 *
 * WHY THIS EXISTS
 * ---------------
 * Nothing else in the product can create the first account:
 *   - public signup was deliberately removed (auth.controller.ts says so in as many words);
 *     AuthService.signup() survives only as dead code and no web page calls it,
 *   - POST /users (the Staff screen) refuses every business-wide role — a shop owner is never
 *     created by another tenant user (users.service.ts STAFF_ASSIGNABLE_ROLES),
 *   - POST /platform/tenants needs an existing SUPER_ADMIN to authenticate as, which an empty
 *     database does not have,
 *   - prisma/seed.ts does create one, but it also plants a whole demo business ("Grand Plaza
 *     Retail"), demo items, invented balances, hotel rooms and three accounts whose passwords are
 *     committed to this repository. It must NEVER touch a production database.
 *
 * So this script exists to do the one thing that is missing: create one real business, its one
 * real shop, and one real owner login, using the application's own code where the application
 * has code (bootstrapShopDefaults, ROLE_PERMISSIONS, isStrongPassword, bcrypt cost 12) and
 * inventing nothing.
 *
 * WHAT IT CREATES — the complete list
 * -----------------------------------
 *   1 Business            (name/slug/email from the flags below)
 *   1 Branch              type SHOP, isDefault true, code MAIN — the shape POST /branches uses
 *   1 Warehouse           the empty storage location every shop gets (signup and POST /branches
 *                         both create one; see the note on WAREHOUSE below)
 *   1 owner User          role ADMIN by default, active / approved / unlocked
 *   ...plus exactly what bootstrapShopDefaults() gives any new shop:
 *   1 Cash account        "<shop> Cash", opening balance 0, balance 0
 *  10 expense categories  the standard list in src/branches/shop-setup.util.ts
 *   5 item categories     empty containers, no items
 *  12 txn number sequences  one per TXN_TYPE, nextNumber 1
 *
 * It creates NO items, NO parties/customers/suppliers, NO transactions, NO employees, NO payroll,
 * NO hotel rooms, NO stock and NO non-zero balance. In non-force mode it asserts those tables are
 * still empty before it commits, and aborts (rolling back) if they are not.
 *
 * USAGE
 * -----
 *   cd "apps/api"
 *
 *   # 1. rehearse (DEFAULT — writes nothing)
 *   DATABASE_URL='postgresql://...' npx ts-node scripts/create-first-owner.ts \
 *       --email owner@shop.com --business "Al Noor Traders" --name "Hussain Ali"
 *
 *   # 2. do it for real
 *   DATABASE_URL='postgresql://...' npx ts-node scripts/create-first-owner.ts \
 *       --email owner@shop.com --business "Al Noor Traders" --name "Hussain Ali" --apply
 *
 * The password is asked for interactively (typed twice, never echoed) when the terminal allows
 * it. For a non-interactive run, pass it in the environment — OWNER_PASSWORD='...' — rather than
 * on the command line, where it would land in your shell history:
 *
 *   DATABASE_URL='postgresql://...' OWNER_PASSWORD='...' npx ts-node scripts/create-first-owner.ts ... --apply
 *
 * On Supabase, use the DIRECT (session) connection string — port 5432, the same value as
 * DIRECT_URL — not the pooled port-6543 one. Everything here happens in one interactive
 * transaction, and the direct connection is the one that has no pgbouncer caveats. The pooled URL
 * does work, but only with `?pgbouncer=true` appended.
 *
 * FLAGS
 * -----
 *   --email <addr>       owner's login address (env OWNER_EMAIL)          [required]
 *   --business <name>    business / shop name (env BUSINESS_NAME)         [required]
 *   --password <pw>      owner's password (env OWNER_PASSWORD, or prompt) [required]
 *                        (use the --password='...' form; a value that itself begins with "--"
 *                        is not recognised as a flag value — the prompt or env is safer anyway)
 *   --name "First Last"  owner's display name (env OWNER_NAME)            [default "Owner"]
 *   --role <ROLE>        ADMIN | SUPER_ADMIN (env OWNER_ROLE)             [default ADMIN]
 *   --branch <name>      name of the default shop (env BRANCH_NAME)       [default "Main Store"]
 *   --phone <number>     business + owner phone (env OWNER_PHONE)         [optional]
 *   --apply              actually commit. Without it this is a dry run.
 *   --dry-run            explicit form of the default.
 *   --force              override the "database already has users" refusal. See SAFETY below.
 *
 * SAFETY
 * ------
 * It refuses to do anything if the database already contains ANY non-deleted user, unless --force
 * is passed — so it cannot be used to quietly mint a second admin later. The check runs twice:
 * once up front (to print who is already there and stop early) and again INSIDE the transaction,
 * so two concurrent runs cannot both pass it.
 *
 * Everything happens in ONE interactive transaction. A dry run performs the real writes and then
 * deliberately throws, which rolls the whole thing back — that is why its output can report exact
 * counts instead of guesses, and it also proves point (9): a failure part-way leaves the database
 * exactly as empty as it was. Nothing is created outside that transaction.
 *
 * The password is hashed with bcrypt at cost 12, the same cost auth.service.ts uses everywhere it
 * hashes, so the ordinary login path accepts it. The plaintext is never printed, never logged and
 * never written anywhere by this script.
 *
 * ON THE WAREHOUSE
 * ----------------
 * A warehouse holds no data — it is the location stock rows point at. Both legitimate shop-creation
 * paths (AuthService.signup and BranchesService.create) create one, and if it is missing the first
 * stock write silently invents one named "Store Warehouse" with a code derived from a UUID
 * (inventory/warehouse.util.ts). Creating it here keeps the new shop identical to one made by the
 * app, and stays within "structural defaults": it contains nothing.
 */
// TYPE-ONLY, and loaded lazily below on purpose. Requiring @prisma/client has a side effect:
// it reads apps/api/.env into process.env. That would quietly satisfy the DATABASE_URL check in
// main() with the LOCAL DEV database URL whenever the operator forgot to set one — the single
// most expensive mistake this script could make. So the environment is captured first (see
// DATABASE_URL below) and the client is required afterwards.
import type { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as readline from 'readline';
import {
  PASSWORD_POLICY_MESSAGE,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  SystemRole,
  isStrongPassword,
} from '@nexus/shared';
import { bootstrapShopDefaults } from '../src/branches/shop-setup.util';
import { TXN_TYPES } from '../src/txns/txn.constants';
import { insensitiveEquals } from '../src/common/escape-like';

/**
 * The target database, read from the real environment BEFORE @prisma/client can inject
 * apps/api/.env into process.env. Nothing else in this file reads process.env.DATABASE_URL.
 * (None of the imports above touch @prisma/client at runtime: shop-setup.util's `Prisma` import
 * is type-only and is elided. Verified by running this script with DATABASE_URL unset — it
 * refuses instead of connecting to the dev database.)
 */
const DATABASE_URL = process.env.DATABASE_URL;

/** Required only once the environment above has been captured. */
function loadPrismaClient(): typeof import('@prisma/client').PrismaClient {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return (require('@prisma/client') as typeof import('@prisma/client')).PrismaClient;
}

/**
 * The exact cost auth.service.ts uses (`bcrypt.hash(password, 12)` in signup, changePassword and
 * resetPasswordWithCode) and users.service.ts uses for staff. A different cost still verifies —
 * the cost is embedded in the hash — but matching it keeps every account in the database
 * indistinguishable from one the app made itself.
 */
const BCRYPT_COST = 12;

/** platform.service.ts hides this slug from every tenant list; never hand it to a real business. */
const RESERVED_SLUG = 'nexus-platform';

/**
 * The two roles that own a business, and the only ones this script will create.
 *
 * ADMIN is the default and is almost certainly what you want. Read roles.ts: the product's labels
 * are deliberately shifted one step from the enum names — ROLE_LABELS maps ADMIN to "Super Admin"
 * and SUPER_ADMIN to "Platform Admin". ADMIN is the shop owner: ROLE_PERMISSIONS.ADMIN holds
 * BUSINESS_MANAGE (which is what the Users screen, the shop switcher and BranchScopeGuard all test
 * to decide "is this the owner?"), every POS/inventory/payroll/expense/report permission, AUDIT_VIEW
 * and SETTINGS_MANAGE — everything except PLATFORM_MANAGE.
 *
 * SUPER_ADMIN is not a bigger owner, it is a different job: the platform operator, holding
 * PLATFORM_MANAGE, i.e. the /platform screens that list and create OTHER businesses. Give it to the
 * shop owner only if the same person is also running the platform (for example, if they intend to
 * onboard further businesses through POST /platform/tenants later — nothing else in the product
 * can do that, and this script refuses a second run without --force).
 */
const OWNER_ROLES: string[] = [SystemRole.ADMIN, SystemRole.SUPER_ADMIN];

/** Thrown at the end of a dry run so Postgres rolls the rehearsal back. Never an error. */
class DryRunRollback extends Error {}

/** Aborts the transaction (and therefore rolls it back) when a safety check fails mid-flight. */
class AbortTransaction extends Error {}

// ── CLI plumbing ────────────────────────────────────────────────────────────
const ARGV = process.argv.slice(2);

/** Supports both `--flag value` and `--flag=value`. */
function arg(name: string): string | undefined {
  const withEquals = ARGV.find((a) => a.startsWith(`--${name}=`));
  if (withEquals !== undefined) return withEquals.slice(name.length + 3);
  const i = ARGV.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const next = ARGV[i + 1];
  return next !== undefined && !next.startsWith('--') ? next : '';
}

function has(name: string): boolean {
  return ARGV.includes(`--${name}`);
}

const APPLY = has('apply');
const FORCE = has('force');

const line = (ch = '─') => ch.repeat(78);

/**
 * Asks for a secret on a real terminal without echoing it — no characters, no asterisks, like
 * sudo. The prompt is written directly to stdout and readline's own output is silenced
 * completely, rather than filtered: a filter that lets the prompt through also lets through the
 * full line redraw readline performs on backspace, which would print the password.
 */
function promptSecret(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {};
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

/** Shows which database is about to be touched, without ever revealing the password in the URL. */
function describeTarget(url: string): string {
  try {
    const u = new URL(url);
    const db = u.pathname.replace(/^\//, '') || '(default)';
    return `${u.username || '(no user)'}@${u.hostname}:${u.port || '5432'}/${db}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

function slugify(name: string): string {
  // Same transformation AuthService.signup and PlatformService.createTenant use.
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function fail(message: string): never {
  console.error(`\n${line('━')}\nREFUSED: ${message}\n${line('━')}\n`);
  process.exit(1);
}

// ── Configuration ───────────────────────────────────────────────────────────
type Config = {
  email: string;
  password: string;
  businessName: string;
  branchName: string;
  firstName: string;
  lastName: string;
  phone?: string;
  role: string;
};

async function readConfig(): Promise<Config> {
  const email = (arg('email') ?? process.env.OWNER_EMAIL ?? '').trim();
  const businessName = (arg('business') ?? process.env.BUSINESS_NAME ?? '').trim();
  const branchName = (arg('branch') ?? process.env.BRANCH_NAME ?? 'Main Store').trim();
  const fullName = (arg('name') ?? process.env.OWNER_NAME ?? '').trim();
  const phone = (arg('phone') ?? process.env.OWNER_PHONE ?? '').trim() || undefined;
  const role = (arg('role') ?? process.env.OWNER_ROLE ?? SystemRole.ADMIN).trim().toUpperCase();

  if (!email) fail('--email is required (or set OWNER_EMAIL).');
  // Deliberately loose: the address only has to be a plausible one, and the app itself does no
  // more than this. Its real job here is catching a shifted flag, e.g. `--email --apply`.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(`"${email}" does not look like an email address.`);
  if (!businessName) fail('--business is required (or set BUSINESS_NAME) — the business / shop name.');
  if (!branchName) fail('--branch cannot be empty.');
  if (!slugify(businessName)) {
    fail(`"${businessName}" contains no letters or digits, so it cannot produce a URL slug.`);
  }

  if (!OWNER_ROLES.includes(role)) {
    const known = Object.values(SystemRole).includes(role as SystemRole);
    fail(
      `--role ${role} is not an owner role. Use ADMIN (the shop owner, shown as "Super Admin") or `
      + `SUPER_ADMIN (the platform operator).`
      + (known
        ? `\n         ${role} is a staff role — add those from Settings → Staff management once you can sign in.`
        : `\n         Known roles: ${Object.values(SystemRole).join(', ')}.`),
    );
  }

  const parts = fullName ? fullName.split(/\s+/) : [];
  const firstName = parts[0] || 'Owner';
  const lastName = parts.slice(1).join(' ');

  // Flag, then environment, then a hidden prompt. The prompt is preferred in practice: a password
  // on the command line is kept in your shell history and is visible in `ps`.
  let password = arg('password') ?? process.env.OWNER_PASSWORD ?? '';
  if (!password) {
    if (!process.stdin.isTTY) {
      fail('No password given. Pass OWNER_PASSWORD=... in the environment, or run on a terminal to be prompted.');
    }
    password = await promptSecret('Password for the new owner account: ');
    const again = await promptSecret('Type it again to confirm:          ');
    if (password !== again) fail('The two passwords did not match. Nothing was done; run it again.');
  }
  if (!password) fail('The password was empty.');
  // The app's own policy, imported rather than restated, so this can never be the weaker gate.
  if (!isStrongPassword(password)) fail(`That password is too weak. ${PASSWORD_POLICY_MESSAGE}.`);

  return { email, password, businessName, branchName, firstName, lastName, phone, role };
}

// ── Pre-flight: is this database really empty? ───────────────────────────────
async function preflight(prisma: PrismaClient, cfg: Config) {
  // The guard is on the COUNT, not on the sample below: a database with 500 users must not slip
  // through because only the first few were fetched.
  const total = await prisma.user.count({ where: { deletedAt: null } });

  if (total === 0) {
    console.log('Safety check: no non-deleted users exist. This database is unclaimed.\n');
    return;
  }

  const sample = await prisma.user.findMany({
    where: { deletedAt: null },
    select: { email: true, role: true, business: { select: { name: true, slug: true } } },
    orderBy: { createdAt: 'asc' },
    take: 25,
  });

  console.log(`Safety check: this database ALREADY HAS ${total} non-deleted user account(s):`);
  for (const u of sample) {
    console.log(
      `  ${u.email.padEnd(34)} ${(ROLE_LABELS[u.role as SystemRole] ?? u.role).padEnd(14)}`
      + ` ${u.business.name} (${u.business.slug})`,
    );
  }
  if (total > sample.length) console.log(`  ... and ${total - sample.length} more`);
  console.log('');

  if (!FORCE) {
    fail(
      'this database is not empty, and this script only ever creates the FIRST owner.\n'
      + '         Nothing was written.\n\n'
      + '         If you have lost access to an existing owner account, use "Forgot password" on the\n'
      + '         login page — ADMIN and SUPER_ADMIN accounts can reset themselves by email.\n'
      + '         Staff accounts are added from Settings → Staff management.\n\n'
      + '         If you genuinely mean to add ANOTHER business with its own owner to this database,\n'
      + '         re-run with --force. That is the only way past this check, and it is deliberate:\n'
      + '         it is what stops this script from quietly minting a second admin.',
    );
  }

  console.log('!! --force was passed: proceeding even though the database is NOT empty.');
  console.log('!! You are adding a SECOND business and a SECOND owner account.\n');

  const clash = await prisma.user.findFirst({
    where: { email: insensitiveEquals(cfg.email), deletedAt: null },
    select: { email: true, role: true, business: { select: { name: true } } },
  });
  if (clash) {
    console.log(
      `!! WARNING: ${clash.email} already has an account (${clash.role}) in "${clash.business.name}".\n`
      + '!! An address is only unique per business, so this is allowed — but sign-in then has to pick\n'
      + '!! between the accounts by password (auth.service.ts login), and a wrong password counts a\n'
      + '!! failed attempt against BOTH. Prefer a separate address for the new owner.\n',
    );
  }
}

// ── The one transaction that does everything ────────────────────────────────
async function create(prisma: PrismaClient, cfg: Config, passwordHash: string) {
  await prisma.$transaction(
    async (tx) => {
      // The same guard as preflight, re-run inside the transaction: two concurrent runs cannot
      // both find an empty database at Serializable isolation.
      if (!FORCE) {
        const existing = await tx.user.count({ where: { deletedAt: null } });
        if (existing > 0) {
          throw new AbortTransaction(
            `${existing} user account(s) appeared while this script was running — rolled back, nothing created.`,
          );
        }
      }

      // Slug: the plain one while it is free (a first business on an empty database gets a clean
      // URL), otherwise the app's own `-<base36 timestamp>` suffix so it cannot collide.
      const base = slugify(cfg.businessName);
      let slug = base;
      if (slug === RESERVED_SLUG || (await tx.business.findUnique({ where: { slug } }))) {
        slug = `${base}-${Date.now().toString(36)}`;
        if (await tx.business.findUnique({ where: { slug } })) {
          throw new AbortTransaction(`could not find a free slug for "${cfg.businessName}".`);
        }
      }

      const business = await tx.business.create({
        data: {
          name: cfg.businessName,
          slug,
          // Business.email is the business's own contact address; signup and createTenant both
          // seed it with the owner's. Everything else (address, GST number, state, logo) is left
          // empty for the owner to fill in from Settings — inventing them is how demo data starts.
          email: cfg.email,
          phone: cfg.phone,
        },
      });

      // The default shop. Same shape as BranchesService.create (type SHOP), plus isDefault so the
      // business always has a home branch — remove() refuses to delete it, and TxnCoreService and
      // repair-branchless-money.ts both resolve "the shop a business calls home" through it.
      const branch = await tx.branch.create({
        data: {
          businessId: business.id,
          name: cfg.branchName,
          code: 'MAIN',
          type: 'SHOP',
          isDefault: true,
        },
      });

      // Empty storage location — see ON THE WAREHOUSE in the header.
      await tx.warehouse.create({
        data: {
          businessId: business.id,
          branchId: branch.id,
          name: `${cfg.branchName} Warehouse`,
          code: 'WH-MAIN',
        },
      });

      // The application's own shop bootstrap: cash account at 0, expense categories, empty item
      // categories, txn numbering. Called exactly as POST /branches calls it, so this shop is not
      // a hand-rolled approximation of one.
      await bootstrapShopDefaults(tx, business.id, branch.id, branch.name);

      const permissions = ROLE_PERMISSIONS[cfg.role] ?? [];
      if (permissions.length === 0) {
        throw new AbortTransaction(`ROLE_PERMISSIONS has no entry for ${cfg.role} — refusing to create a powerless owner.`);
      }

      // Every state flag is written EXPLICITLY, for the reason users.service.ts create() gives:
      // schema defaults are invisible at the call site, and this is the one row that must not be
      // wrong — it is the only account that can sign in.
      const owner = await tx.user.create({
        data: {
          businessId: business.id,
          // Pinned to the default shop, exactly as signup pins it. It matters: BranchScopeGuard
          // treats a BUSINESS_MANAGE holder with no branchId as "no branch filter", so the owner
          // would land on a dashboard silently aggregating every shop.
          branchId: branch.id,
          email: cfg.email,
          passwordHash,
          firstName: cfg.firstName,
          lastName: cfg.lastName,
          phone: cfg.phone,
          role: cfg.role,
          permissions,
          isActive: true,
          // The operator running this script IS the approval; an unapproved owner cannot sign in
          // (loginRefusalReason → PENDING) and has nobody above them to approve it.
          isApproved: true,
          approvedAt: new Date(),
          // approvedById stays null: there is no earlier user to point at.
          isLocked: false,
          failedAttempts: 0,
          // emailVerifiedAt stays null on purpose — nothing here proves the mailbox reaches them.
          // Settings → Account will offer to send the confirmation link, and forgot-password works
          // regardless.
          deletedAt: null,
        },
        select: { id: true, email: true, role: true, isActive: true, isApproved: true, isLocked: true },
      });

      // ── Report, from the rows themselves rather than from assumptions ────
      const [cashAccounts, expenseCategories, itemCategories, sequences] = await Promise.all([
        tx.bankAccount.findMany({
          where: { businessId: business.id },
          select: { name: true, accountType: true, openingBalance: true, balance: true },
        }),
        tx.expenseCategory.findMany({ where: { businessId: business.id }, select: { name: true }, orderBy: { name: 'asc' } }),
        tx.category.findMany({ where: { businessId: business.id }, select: { name: true }, orderBy: { sortOrder: 'asc' } }),
        tx.txnNumberSequence.findMany({
          where: { businessId: business.id },
          select: { txnType: true, prefix: true, nextNumber: true },
          orderBy: { txnType: 'asc' },
        }),
      ]);

      // Proof of point (6): nothing but structure exists. Counted business-wide when this is the
      // first owner (the whole database should be bare), and scoped to the new business under
      // --force, where other businesses legitimately have data.
      const scope = FORCE ? { businessId: business.id } : {};
      const nothingElse = {
        items: await tx.item.count({ where: scope }),
        parties: await tx.party.count({ where: scope }),
        transactions: await tx.txn.count({ where: scope }),
        employees: await tx.employee.count({ where: scope }),
        payrolls: await tx.payroll.count({ where: scope }),
        rooms: await tx.room.count({ where: scope }),
        'stock rows': await tx.stockLevel.count({
          where: FORCE ? { item: { businessId: business.id } } : {},
        }),
      };
      const stowaways = Object.entries(nothingElse).filter(([, n]) => n > 0);
      if (stowaways.length) {
        throw new AbortTransaction(
          'this run would have left business data behind, which it must never do: '
          + `${stowaways.map(([k, n]) => `${n} ${k}`).join(', ')}. Rolled back.`,
        );
      }

      const nonZero = cashAccounts.filter((a) => Number(a.balance) !== 0 || Number(a.openingBalance) !== 0);
      if (nonZero.length) {
        throw new AbortTransaction('a money account was created with a non-zero balance. Rolled back.');
      }

      console.log(line('═'));
      console.log(APPLY ? 'CREATED' : 'WOULD CREATE (dry run — this is being rolled back)');
      console.log(line('═'));
      console.log(`  Business    ${business.name}`);
      console.log(`              slug  ${business.slug}`);
      console.log(`              id    ${business.id}`);
      console.log(`              email ${business.email}${business.phone ? `   phone ${business.phone}` : ''}`);
      console.log(`  Shop        ${branch.name}  (code ${branch.code}, type ${branch.type}, default shop)`);
      console.log(`              id    ${branch.id}`);
      console.log(`  Warehouse   ${cfg.branchName} Warehouse  (WH-MAIN, empty)`);
      console.log('');
      console.log(`  Owner       ${owner.email}`);
      console.log(`              role        ${owner.role}  — shown in the app as "${ROLE_LABELS[owner.role as SystemRole] ?? owner.role}"`);
      console.log(`              name        ${cfg.firstName}${cfg.lastName ? ` ${cfg.lastName}` : ''}`);
      console.log(`              id          ${owner.id}`);
      console.log(`              permissions ${permissions.length} (ROLE_PERMISSIONS.${owner.role})`);
      console.log(`              state       active ${owner.isActive}, approved ${owner.isApproved}, locked ${owner.isLocked}, failed attempts 0`);
      console.log(`              shop        ${branch.name} (pinned, and may switch shops)`);
      console.log('');
      console.log('  Shop defaults from bootstrapShopDefaults():');
      for (const a of cashAccounts) {
        console.log(`    money account     ${a.name} (${a.accountType}) — opening ${Number(a.openingBalance).toFixed(2)}, balance ${Number(a.balance).toFixed(2)}`);
      }
      console.log(`    expense categories ${expenseCategories.length}: ${expenseCategories.map((c) => c.name).join(', ')}`);
      console.log(`    item categories    ${itemCategories.length}: ${itemCategories.map((c) => c.name).join(', ')} (all empty — no items)`);
      console.log(`    txn sequences      ${sequences.length}/${TXN_TYPES.length}: ${sequences.map((s) => `${s.prefix}-${s.nextNumber}`).join(' ')}`);
      console.log('');
      console.log('  Verified created nothing else: '
        + Object.keys(nothingElse).map((k) => `0 ${k}`).join(', ') + '.');
      console.log(line('═'));

      if (!APPLY) throw new DryRunRollback();
    },
    {
      // Serializable, like PlatformService.createTenant: it makes the emptiness check above a real
      // guarantee rather than a hopeful read.
      isolationLevel: 'Serializable',
      // bootstrapShopDefaults is ~28 sequential upserts; over a hosted database (Supabase) the
      // 5s default is genuinely tight. The password is hashed before the transaction opens so
      // bcrypt's deliberate slowness is never inside it.
      timeout: 120_000,
      maxWait: 30_000,
    },
  );
}

const USAGE = `
Create the FIRST owner account on an empty database — one business, one shop, one login.

  cd apps/api
  DATABASE_URL='postgresql://...' npx ts-node scripts/create-first-owner.ts \\
      --email owner@shop.com --business "Al Noor Traders" --name "Hussain Ali"      # dry run
  ... same line ... --apply                                                          # commit

  --email <addr>       login address                     (env OWNER_EMAIL)     required
  --business <name>    business / shop name               (env BUSINESS_NAME)   required
  --password <pw>      use --password='...'; better: env OWNER_PASSWORD, or be prompted
  --name "First Last"  display name                       (env OWNER_NAME)      default "Owner"
  --role <ROLE>        ADMIN | SUPER_ADMIN                (env OWNER_ROLE)      default ADMIN
  --branch <name>      the default shop's name            (env BRANCH_NAME)     default "Main Store"
  --phone <number>     business + owner phone             (env OWNER_PHONE)     optional
  --apply              commit. Without it, nothing is written.
  --dry-run            the default, stated explicitly.
  --force              proceed even though the database already has users.

Refuses to run if the database already contains any non-deleted user (unless --force).
Creates no items, parties, transactions, employees, balances or rooms. Never prints the password.
Read the header of this file for the full reasoning.
`;

async function main() {
  if (has('help') || ARGV.includes('-h')) {
    console.log(USAGE);
    return;
  }

  const url = DATABASE_URL;
  if (!url) {
    fail(
      'DATABASE_URL is not set in the environment.\n'
      + '         This script never falls back to apps/api/.env — writing the first owner into your\n'
      + '         local dev database by accident is exactly the mistake worth preventing. Run it as:\n'
      + "           DATABASE_URL='postgresql://...' npx ts-node scripts/create-first-owner.ts ...",
    );
  }

  if (has('dry-run') && APPLY) fail('--dry-run and --apply contradict each other. Pass one.');

  console.log(`\n${line('═')}`);
  console.log(APPLY ? 'CREATE FIRST OWNER — APPLY MODE (rows will be committed)' : 'CREATE FIRST OWNER — DRY RUN (nothing will be written; pass --apply to commit)');
  console.log(line('═'));
  console.log(`Target database: ${describeTarget(url)}`);
  console.log('');

  const cfg = await readConfig();
  console.log(`Owner role: ${cfg.role} — "${ROLE_LABELS[cfg.role as SystemRole] ?? cfg.role}" in the app.`);
  if (cfg.role === SystemRole.SUPER_ADMIN) {
    console.log(
      '!! SUPER_ADMIN is the PLATFORM operator (it adds PLATFORM_MANAGE and the /platform screens\n'
      + '!! that list and create other businesses), not a bigger shop owner. If this person only runs\n'
      + '!! this one shop, use --role ADMIN — the app calls that role "Super Admin".',
    );
  }
  console.log('');

  // Constructed with the URL explicitly so there is no doubt which database is being used —
  // never the ambient one @prisma/client would have picked up from a .env file.
  const Client = loadPrismaClient();
  const prisma = new Client({ datasourceUrl: url });
  try {
    await preflight(prisma, cfg);

    // Outside the transaction on purpose: bcrypt at cost 12 takes a few hundred milliseconds and
    // has no business holding a Serializable transaction open. The app does the same.
    const passwordHash = await bcrypt.hash(cfg.password, BCRYPT_COST);

    try {
      await create(prisma, cfg, passwordHash);
    } catch (err) {
      if (err instanceof DryRunRollback) {
        console.log('\nDRY RUN: every row above was created inside a transaction and then rolled back.');
        console.log('The database is exactly as it was — still empty. Re-run with --apply to commit it.\n');
        return;
      }
      if (err instanceof AbortTransaction) fail(`${err.message}`);
      throw err;
    }

    console.log('\nDone. The owner account is live and can sign in now.');
    console.log(`  Sign in at: ${(process.env.WEB_URL || 'https://<your-web-url>').replace(/\/+$/, '')}/login`);
    console.log(`  Email:      ${cfg.email}`);
    console.log('  Password:   the one you supplied. This script never printed it, never logged it,');
    console.log('              and stored nothing but its bcrypt hash — nobody, including you, can');
    console.log('              read it back out of the database. If it is lost, use "Forgot password"');
    console.log(`              on the login page (${cfg.role} accounts may reset themselves by email).`);
    console.log('\nNext: sign in, then add staff from Settings → Staff management (this script must not');
    console.log('be used for that — it refuses to run again unless --force is passed). Do NOT run');
    console.log('`prisma db seed` / prisma/seed.ts against this database: it plants a demo business and');
    console.log('three accounts whose passwords are published in this repository.\n');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // A Prisma error here means the transaction never committed: nothing partial survives.
  const code = (err as { code?: string }).code;
  if (code === 'P2002') {
    const target = (err as { meta?: { target?: unknown } }).meta?.target;
    console.error(`\nA unique constraint (${JSON.stringify(target)}) rejected this. Nothing was created.`);
  } else {
    console.error('\nFAILED — the transaction rolled back, so nothing was created.\n');
    console.error(err);
  }
  process.exitCode = 1;
});
