# MSW Global — Requirements & Fix Backlog

Tracked, code-grounded backlog for the reported issues. Each item has current
state (with file references), the fix, and acceptance criteria. Worked through
the ralph harness in `ralph/` (see `ralph/prd.json` for machine-readable status).

## Role model (target)

Three primary tiers the UX must make clear (the codebase has 9 granular roles;
these map onto them):

| Tier | Maps to | Scope |
|------|---------|-------|
| **Super Admin** | `SUPER_ADMIN` | Everything — all shops + hotels, every feature, platform portal |
| **Manager** | `ADMIN` / `BRANCH_MANAGER` | Every feature, but only for the shop(s)/hotel(s) they are assigned to (one or many) |
| **Biller** | `BILLER` | POS/billing only for their assigned shop; may view **today's total sales**; **no** profit/loss or any other feature |

---

## Requirements

### R1 — Rename app "Vyaapar" → "MSW Global"  ·  priority: high  ·  size: S
**Current:** brand comes from `packages/shared/src/constants.ts:1` (`APP_NAME = 'Vyaapar'`), plus hard-coded literals in `apps/web/src/app/layout.tsx:6`, `components/platform/platform-sidebar.tsx:23`, `components/layout/top-bar.tsx:12`, `app/(app)/pos/page.tsx:318`, `components/layout/sidebar.tsx:93`. Logo glyph "V" in `sidebar.tsx:198`, `login/page.tsx:64,95`, `signup/page.tsx:61`. Backend: `apps/api/src/main.ts:51,62`.
**Fix:** set `APP_NAME = 'MSW Global'`; replace hard-coded "Vyaapar/Vyapar POS" literals; change "V" glyph to "MSW"; rebuild `@nexus/shared`.
**Accept:** browser tab, sidebar brand, login/signup, POS header, and super-admin portal all read "MSW Global"; no user-facing "Vyaapar/Vyapar" remains.

### R2 — Auto-refresh data lists (no manual reload)  ·  priority: high  ·  size: S
**Current:** POS catalog query (`apps/web/src/hooks/use-pos-catalog.ts:73-76`) uses `staleTime: 10min`, `refetchOnMount: false`, `refetchOnWindowFocus: false`, no polling. Live updates only via Pusher `inventory:updated`, but Pusher env vars are unset so `useSocket` early-returns (`hooks/use-socket.ts:48`). Result: new products don't appear without a hard reload.
**Fix:** enable `refetchOnMount` + `refetchOnWindowFocus` and lower `staleTime` for the POS catalog (and review global defaults in `app/providers.tsx`); optionally a light `refetchInterval` on POS. Keep Pusher as the instant path when configured.
**Accept:** adding a product and returning to POS (or refocusing the tab) shows it without a manual page refresh.

### R3 — Party supplier bug (supplier saved as customer)  ·  priority: high  ·  size: S
**Current:** create reads `body.partyType` (`apps/api/src/parties/parties.service.ts:128`) and defaults to `CUSTOMER`, but list/filter uses `type` (`parties.controller.ts:22`). Form sends `type` → `partyType` is undefined → always CUSTOMER. No enum validation.
**Fix:** accept `type` as an alias of `partyType` on create/update; validate against `CUSTOMER|SUPPLIER|BOTH`. Verify the web party form field name.
**Accept:** creating a party as Supplier persists `partyType = SUPPLIER` and it appears under Suppliers.

### R4 — Password strength + show/hide  ·  priority: medium  ·  size: S
**Current:** backend already requires ≥8 chars + a letter + a number (`packages/shared/src/password-policy.ts`). Eye toggle already exists (`components/ui/password-input.tsx`) and is used on login/signup/forgot/staff-create. Gap: staff-create form (`app/(app)/settings/users/page.tsx`) has no client-side validation and no visible rule hint.
**Fix:** add client-side strength validation + a visible requirement hint to the staff-create form (and any field missing it). Confirm eye toggle on every password field.
**Accept:** weak staff passwords are rejected client-side with a clear message; every password field has a working show/hide eye.

### R5 — Add-category from the UI (items + expenses)  ·  priority: high  ·  size: M
**Current:** hotel room categories have a full create flow (`app/(app)/hotel/room-types/page.tsx`). But **item** categories (`app/(app)/items/page.tsx:661`) and **expense** categories (`components/vyapar/txn-form.tsx`, `app/(app)/hotel/expenses/page.tsx`) are select-only — no create path in the UI. Backend item-category create (`apps/api/src/categories/categories.service.ts:16`) needs a client-supplied unique `slug` and doesn't auto-generate or handle duplicates.
**Fix:** backend — auto-generate slug from name + handle duplicate gracefully. Frontend — add an inline "＋ Add category" option to the item form and the expense/txn form.
**Accept:** a user can create a new item category and a new expense category from within their forms and immediately select it.

### R6 — Credit settle: collect payment (unpaid → paid)  ·  priority: high  ·  size: M
**Current:** settlement works only by creating a separate Payment-In txn (`apps/api/src/sale/sale.service.ts:197`, auto-allocates FIFO); the party/ledger screen (`app/(app)/parties/page.tsx`) has only Edit/Delete — no "Collect payment"/settle action, and invoice status isn't togglable there.
**Fix:** add a "Collect Payment" action on the party detail (and/or per unpaid invoice) that posts a payment-in for the outstanding amount and refreshes the ledger. Optional backend convenience endpoint `POST /sale/invoices/:id/settle`.
**Accept:** from a credit customer's page, one action records payment and the invoice/balance flips toward PAID.

### R7 — Payroll: all staff + advance/custom salary  ·  priority: medium  ·  size: M
**Current:** `generatePayroll` (`apps/api/src/payroll/payroll.service.ts:131-173`) is scoped to a single resolved branch — multi-branch/entity staff are excluded. Only a fixed `baseSalary` + inline `deductions`; no advance or custom/one-off amount (`app/(app)/payroll/page.tsx`).
**Fix:** generate across all branches/entities of the business (or accept a branch filter but default to all). Add advance-salary and custom-amount/bonus fields to the payroll line + UI.
**Accept:** one "Generate" run creates payroll lines for every active staff member across entities; a user can pay an advance or set a custom amount for a period.

### R8 — RBAC: Super Admin / Manager / Biller  ·  priority: high  ·  size: L
**Current:** 9 roles with backend guards enforced (`common/guards/*`); super-admin portal exists (`app/platform/`, guarded). Gaps: (a) front-end pages aren't route-guarded (nav is hidden but direct URL loads the page — data is still API-protected); (b) BILLER has no "today's sales total" view and shouldn't see P&L; (c) staff-create UI can't assign a Manager tier clearly / multi-shop.
**Fix:** add client route guards so a role that lacks a page's permission is redirected; give Biller a POS-scoped "today's sales" summary without P&L; make staff-create expose the 3 tiers and support assigning a Manager to one or more shops.
**Accept:** a Biller can only reach POS + today's-sales and is redirected from reports/inventory/etc.; a Manager sees all features for their assigned shop(s) only; Super Admin sees everything.

### R9 — Product return button (UI)  ·  priority: medium  ·  size: S
**Current:** refund/return APIs exist (`apps/api/src/sale/sale.service.ts:112` `refundInvoice`, credit notes, debit notes) but there is no return/refund button surfaced in the sales/invoice UI.
**Fix:** add a "Return / Refund" action on a sale invoice (POS history / invoice view) wired to the existing refund/credit-note endpoint, gated by `POS_REFUND`.
**Accept:** from a completed sale, an authorized user can issue a return and the invoice shows REFUNDED and stock/party balances update.

### R10 — Barcode 2-up + thermal bill customization  ·  priority: medium  ·  size: L
**Current:** barcode printing supports N slips per item via qty (`components/pos/tag-print-picker.tsx`, `lib/print-tags.ts`) but only post-sale — no standalone "print barcodes" from items and no default 2-up. Thermal receipt is server-rendered (`/receipts/:id/thermal`); settings has a `printTheme?` field but no UI control — no thermal customization.
**Fix:** add a "Print barcode" action on the items page with a quantity (default 2); add a Thermal Bill customization card in Settings (header/footer text, show logo, paper width) and apply it in the thermal receipt template.
**Accept:** a user can print 2 barcode slips for an item from the items page; Settings lets them customize the thermal bill and the printed receipt reflects it.

---

## Execution order (ralph priority)
R1 → R2 → R3 → R4 → R5 → R6 → R9 → R7 → R8 → R10, then typecheck/build/deploy.
Quick correctness/visibility wins first; largest features (RBAC, thermal) last.
