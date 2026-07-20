# Vyaapar Platform

A **Vyapar-parity billing, inventory & accounting platform** for Indian SMBs — GST invoicing, full sale/purchase lifecycle, bill-wise payments, cash & bank, 25+ reports — plus an integrated **Hotel PMS** module.

## Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15, TypeScript, Tailwind, Zustand, TanStack Query, Sonner |
| Backend | NestJS, Prisma, PostgreSQL, Pusher (realtime) |
| Storage | Local disk (dev) / MinIO-S3 or Vercel Blob (prod) |
| Infra | Docker Compose + Nginx (Oracle Cloud), or Vercel (see below) |

## Quick start

```bash
pnpm docker:up
pnpm install
cd packages/shared && pnpm build
cd ../../apps/api && pnpm exec prisma db push
TS_NODE_COMPILER_OPTIONS='{"module":"commonjs"}' pnpm exec ts-node prisma/seed.ts
cd ../.. && pnpm dev
```

Or simply: `bash scripts/launch-local.sh`

| Service | URL |
|---------|-----|
| Web | http://localhost:3000 |
| API | http://localhost:4000 |
| Swagger | http://localhost:4000/api/docs |

### Demo login

| Role | Email | Password |
|------|-------|----------|
| Super Admin (platform console) | superadmin@nexus.demo | SuperAdmin@123456 |
| Admin | admin@grandplaza.demo | Demo@123456 |
| Cashier | cashier@grandplaza.demo | Demo@123456 |

## Vyapar feature parity

### Core model
Every business document is a unified **Txn** (`apps/api/src/txns/`):
`SALE_INVOICE · CREDIT_NOTE · SALE_ORDER · DELIVERY_CHALLAN · ESTIMATE · PAYMENT_IN · PURCHASE_BILL · DEBIT_NOTE · PURCHASE_ORDER · PAYMENT_OUT · EXPENSE · P2P_TRANSFER`

Each transaction atomically updates stock, party balance, cash/bank balances, and the party ledger. Deletes reverse all effects (recycle bin with restore).

### Parties
- Unified Party (customer / supplier / both), GSTIN & GST type, billing/shipping address, party groups, credit limit, opening balance
- Ledger statement with running balance, receivable/payable summary, Excel import

### Items
- Products & services, HSN/SAC, base + secondary units with conversion
- Sale / purchase / wholesale / MRP pricing, tax-inclusive flags
- Opening stock, min-stock alerts, stock adjustments, barcode generation (Code128/QR), bulk import

### Sale cycle
- Sale invoices (with item + bill discounts, additional charges, round-off, split payments, credit sales)
- Estimates/quotations → convert; Sale orders → convert; Delivery challans → convert
- Credit notes (sale returns) with stock & balance effects; full-invoice refunds
- Payment-in with **bill-wise allocation** (FIFO auto or manual)

### Purchase cycle
- Purchase bills (stock IN, payable, purchase price update)
- Purchase orders → receive into bills; Debit notes (purchase returns)
- Payment-out with allocation

### Cash & Bank
- Cash-in-hand + bank accounts, transfers/adjustments, account statements
- **Cheque lifecycle** (open → deposit/withdraw → reopen)
- **Loan accounts** with EMI payments, interest & charges

### Reports (25+)
Sale, Purchase, Day Book, All Transactions, Cash Flow, Bill-wise Profit, P&L, Balance Sheet, Trial Balance, Party Statement, All Parties, Party-wise P&L, Sale/Purchase by Party, Stock Summary, Item-wise Profit, Low Stock, Stock Detail, Sale/Purchase by Item Category, Discount, **GSTR-1, GSTR-2, GSTR-3B (CGST/SGST/IGST aware)**, HSN Summary, Tax Rate, Expense by Category, Order reports — with XLSX/CSV export and GSTR-1 JSON export.

### Other
- POS billing screen (barcode scan, held bills, offline queue + sync)
- Payment reminders, expense categories (GST/non-GST)
- Transaction numbering prefixes per type, invoice print (regular PDF + thermal), WhatsApp/email share stubs
- Verify-my-data utility (recomputes balances/stock and reports or fixes drift)
- Multi-user RBAC, audit log, real-time socket events

### Hotel PMS (kept module)
Room grid & categories, reservations, walk-in check-in with Aadhaar OCR, folio charges/payments, night audit (ADR/RevPAR), dynamic rates, housekeeping & service requests.

## Project structure

```
apps/api/src/
  txns/        ← unified transaction engine (numbering, stock, ledger, money)
  parties/ items/ sale/ purchase/ cash-bank/ expenses/
  reports/ settings/ utilities/ reminders/
  hotel/ housekeeping/ services/ payroll/ platform/ ...
apps/web/src/
  app/(app)/dashboard|parties|items|sale|purchase|cash-bank|expenses|reports|pos|hotel
  components/vyapar/   ← unified TxnForm + TxnListPage
packages/shared/       ← roles & permissions
scripts/
  e2e-smoke.mjs            ← full lifecycle smoke test (pnpm test:e2e)
  migrate-vyapar-data.mjs  ← legacy → Vyapar data migration (export/import phases)
```

## Migrating a legacy database

```bash
node scripts/migrate-vyapar-data.mjs export          # snapshot legacy tables
pnpm --filter @nexus/api exec prisma db push --accept-data-loss
node scripts/migrate-vyapar-data.mjs import          # map into Party/Item/Txn
```

## Production (Docker)

```bash
cp .env.example .env   # set JWT secrets, etc.
pnpm docker:prod:build
pnpm docker:prod:up
```

### Oracle Cloud Always Free ($0 / 3 shops)

Full guide: **[deploy/oracle/ORACLE_SETUP.md](deploy/oracle/ORACLE_SETUP.md)**

```bash
# On Oracle VM after SSH:
cd ~/vyaapar
bash deploy/oracle/install.sh
```

- Rotate `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ENCRYPTION_KEY`
- Set `PUBLIC_URL` to your VM IP or domain in `.env`
- Put Nginx in front (`deploy/nginx.conf`); Postgres runs in the same Docker Compose stack

## Production (Vercel)

Two separate Vercel projects — the NestJS API can't run as a normal always-on
server on Vercel, so it's wrapped as a single serverless function; the
Next.js app deploys as-is.

| Project | Root Directory | Notes |
|---------|-----------------|-------|
| `vyaapar-api` | `apps/api` | Serverless entry: `apps/api/api/index.js`. Enable "Include files outside the Root Directory" in project settings (the build command reaches up to the pnpm workspace root). |
| `vyaapar-web` | `apps/web` | Framework auto-detected (Next.js). |

External services (accounts you create yourself — Vercel doesn't provision these):

- **Supabase** (Postgres) → `DATABASE_URL` (pooled, port 6543, `?pgbouncer=true`) + `DIRECT_URL` (direct, port 5432, used only by `prisma migrate`)
- **Pusher** (Channels app, realtime) → `PUSHER_APP_ID` / `PUSHER_KEY` / `PUSHER_SECRET` / `PUSHER_CLUSTER` on the API, `NEXT_PUBLIC_PUSHER_KEY` / `NEXT_PUBLIC_PUSHER_CLUSTER` on the web app
- **Vercel Blob** → attach a store to the `vyaapar-api` project (auto-populates `BLOB_READ_WRITE_TOKEN`); set `STORAGE_DRIVER=vercel-blob`

Set `CORS_ORIGIN` on the API project to the web app's deployed URL(s), and
`NEXT_PUBLIC_API_URL` on the web project to the API project's deployed URL.

Aadhaar OCR (`tesseract.js`) and report/export generation can run long —
Vercel's Hobby plan caps function duration at 10s regardless of config; the
API's `vercel.json` requests `maxDuration: 60`, which needs a Pro plan to take effect.
