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

---

## Batch 2 — reported issues (2026-07-24)

Second round of user-reported issues + feature requests. Product decisions the
user made when asked: signup CTA → "Sign Up"; add-item required fields → Name,
Category, Sale Price, Cost Price, Unit, Opening Stock, Barcode; add-party required
→ Name + Phone + Type; notifications → low-stock alerts only.

### R11 — Signup: "Sign Up" CTA + visible password rules + no email verification · S
**Current:** button says "Start Free Trial" (`signup/page.tsx:93`); zod + backend `@IsStrongPassword` already reject weak passwords; there is no email-verification step anywhere (signup issues tokens immediately). **Fix:** rename CTA to "Sign Up"; show password-requirement hint so enforcement is visible; confirm no verification gate. **Accept:** button reads "Sign Up"; weak passwords blocked with a hint; signup → immediate access.

### R12 — Friendly duplicate-SKU / unique errors (no 500) · S
**Current:** item create has no P2002 handling (`items.service.ts:161-222`, unique `[businessId,branchId,sku]` at schema:328); duplicate SKU → HTTP 500 "Internal server error". No global exception filter. **Fix:** global Prisma exception filter mapping P2002→409 (name the field) and P2025→404. **Accept:** duplicate Item Code shows a clear message, not 500.

### R13 — Housekeeping & Services keep Hotel PMS header · S
**Current:** `/housekeeping` and `/services` are top-level `(app)` routes, siblings of `hotel/`, so `HotelLayout` (header + tabs) doesn't wrap them; the hotel tab bar links to absolute `/housekeeping` → header disappears. **Fix:** move under `hotel/` (or share the layout); align styling; fix 2 unescaped-quote lint errors. **Accept:** header/tabs persist on Housekeeping & Services.

### R14 — Replace window.prompt add-category with proper UI · S/M
**Current:** R5 added add-category via `window.prompt` (`items/page.tsx:326`, `txn-form.tsx:130`). **Fix:** inline field or dialog instead of the browser prompt. **Accept:** add-category uses in-app UI; new category auto-selected.

### R15 — Add-item required fields + backend validation · M
**Current:** only name required, client + backend (`items/page.tsx:655`, `items.service.ts:162`). **Fix:** require Name, Category, Sale Price, Cost Price, Unit, Opening Stock, Barcode on client and backend. **Accept:** incomplete item rejected with clear messages both sides.

### R16 — Add-party required fields (Name + Phone + Type) · M
**Current:** only name required (`parties/page.tsx:557`, `parties.service.ts:107`). **Fix:** require Name + Phone + explicit Type, client + backend. **Accept:** incomplete party rejected both sides.

### R17 — Import: CSV + real result feedback + template · M
**Current:** import is JSON-only (`utilities/page.tsx:65`) but export is XLSX → round-trip impossible; result always toasts success, hiding skipped/errors. **Fix:** accept CSV (+JSON), surface `{created,skipped,errors}`, add a downloadable template. **Accept:** CSV import works, real counts shown, dup-SKU reported per row.

### R18 — Mobile shop/hotel switcher + menu · M
**Current:** `ShopSwitcher` lives only in the `hidden lg:flex` sidebar (`sidebar.tsx:206`); mobile bottom nav has no switcher and no hotel entry; no hamburger/drawer. **Fix:** surface switcher + "More" nav (Hotel/Payroll/Staff/Settings) on mobile via top-bar control or sheet. **Accept:** mobile users can switch shop and reach the hotel.

### R19 — Low-stock notifications (make the bell work) · M
**Current:** full notification plumbing (bell, polling, Pusher, endpoints, model) but `emitNotification`/`notification.create` are never called → always empty. **Fix:** create a low-stock Notification when a txn drops an item to/below minStock (or 0). **Accept:** selling an item below min stock produces a bell alert.

### R20 — Hotel item category management · M/L
**Current:** item categories are retail-only (`/items` + New → `/categories`); hotel has only Room *types* and a hardcoded `SERVICE_TYPES` enum; folio charges are free-text. **Fix:** category create/manage + filter for hotel items (Food/Beverages/Snacks/Desserts/Room Service). **Accept:** hotel user can create & filter item categories.

### R21 — RBAC 3-tier labels + multi-shop Manager · M
**Current:** R8 added Biller lockdown + today's-sales; users have a single `branchId`; staff UI doesn't clearly present the 3 tiers or multi-shop managers. **Fix:** 3-tier staff UI + assign a Manager to one/many shops, scoped accordingly. **Accept:** staff form shows tiers; multi-shop manager scoping works.

### R22 — Credit payment proper form · M
**Current:** Collect Payment uses `window.prompt`, cash-only, FIFO auto-allocate (`parties/page.tsx:245`). **Fix:** in-app form — amount (partial ok), Cash/Bank mode, note, optional per-invoice allocation. **Accept:** form-based collect; partial + mode supported.

### R23 — Return / Refund / Exchange (per-item + history) · L
**Current:** whole-invoice full refund only (`sale.service.ts:112-141`); no per-item, no exchange, no return history screen. **Fix:** per-item/qty returns, Refund vs Exchange, auto inventory, Returns history. **Accept:** partial item returns + exchange + history all work.

### R24 — Customizable label/barcode designer · L
**Current:** `print-tags.ts` hardcodes 50×25mm, Name+price+barcode only, fixed fonts/sizes. **Fix:** field selection (Name/Category/Size/Colour/MRP/Barcode/SKU/Batch), size/margins/font/alignment/barcode-size, paper presets, persisted in settings. **Accept:** designed label reflected in print.

### R25 — Payroll advance ledger + payslip + per-employee history · L
**Current:** advance is a manual per-run netting; no tracked auto-deduction, no payslip, no per-employee history. **Fix:** persistent advance balance auto-deducted next run; payslip generate/print; per-employee salary history. **Accept:** advance auto-deducts; payslip prints; history visible.

### Execution order (batch 2)
R11 → R12 → R13 → R14 → R15 → R16 → R17 → R18 → R19 → R20 → R21 → R22 → R23 → R24 → R25.
Small correctness/visibility fixes first; large features (returns/exchange, label designer, payroll advance) last.

---

## Batch 3 — reported issues (2026-07-25)

Investigated deeply before coding. Findings summarized per item.

### R26 — Create Hotel AND Shop entities, kept separate · M
**Current:** `Branch.type` is a free string (default SHOP; no enum). Shops page (`shops/page.tsx:54`) hardcodes `type:'SHOP'`; hotel page (`hotel/page.tsx:163`) hardcodes `type:'HOTEL'` — both creation flows exist but in separate places. Signup (`auth.service.ts:43-48`) always makes one SHOP. `branches.service.create:34` bootstraps defaults only for SHOP; a HOTEL gets just a warehouse. **Fix:** entities page offers Add Shop + Add Hotel (separate sections), validate type∈{SHOP,HOTEL}, add `bootstrapHotelDefaults`. **Accept:** can create both, kept separate, hotel usable immediately.

### R27 — Return by bill number + specific items · M
**Current:** backend partial refund (`refundInvoice` `lineIds`) and invoice search-by-`txnNumber` already work (R23). Per-item picker exists ONLY in POS Recent Bills (`recent-orders-panel.tsx`). The Sale Invoices list Return button (`txn-list-page.tsx:143-156`) still does whole-invoice refund (`body:{}`). **Fix:** extract the POS picker into a shared `ReturnDialog`; wire it to the Sale Invoices list (already has a bill-number search box). **Accept:** find bill by number → pick specific items → Refund/Exchange.

### R28 — Payroll start/end date + payslips for all · M
**Current:** `generatePayroll` takes `period` YYYY-MM (regex `payroll.service.ts:134`); `period` is a free-form String (no DB format; unique on businessId+branchId+period). Payslip is on-demand per line (`printPayslip` `page.tsx:193-215`); no bulk print. **Fix:** accept start+end date, store period as `start..end` string (no migration); add "Print all payslips" concatenating the existing layout with page breaks. **Accept:** date-range run + one-click payslips for everyone.

### R29 — Barcode label positional (drag) designer · L
**Current:** `LabelConfig` = per-field booleans + label-wide size/font/align; `print-tags.ts` renders a FIXED flex-column order (`FIELD_ORDER`), no x/y. localStorage only. **Fix:** per-field {show,xMm,yMm,fontPt,align,bold}; drag on a scaled preview; render absolute-positioned. Client-only, backward-compatible. **Accept:** move fields anywhere on the label.

### R30 — Thermal receipt format designer · L
**Current:** `generateThermal` (`receipts.service.ts:61-121`) is a hardcoded 80mm template; only `receiptHeader`/`receiptFooter` strings customizable (FirmSettings). **Fix:** `FirmSettings.receiptLayout Json?` (db push) holding ordered sections + show/hide + font size; refactor generateThermal to iterate it; settings UI. Flow-based (no free x/y — single-column receipt). **Accept:** reorder/show-hide receipt sections + font size, reflected in print.

### R31 — Availability-aware room picker (check-in + reservation) · M
**Current:** a room `<select>` exists (`check-in/page.tsx:179-202`) but `GET /hotel/rooms` (`hotel.service.ts:18-24`) returns ALL rooms (no status/date filter) — occupied/reserved rooms are selectable and rejected on submit; future reservations aren't filtered by dates. `checkOverlappingReservation` (`:137-162`) is the real guard. **Fix:** filter the dropdown — CHECKIN → AVAILABLE; RESERVATION → no overlap for chosen dates (backend getRooms availability params, re-filter on date change). **Accept:** picker only offers bookable rooms.

### Execution order (batch 3)
R26 → R27 → R28 → R29 → R30 → R31.

---

## Batch 4 — reported issues (2026-07-25, post-deploy)

Deep-investigated; several are regressions/gaps on batch-3 work.

### R32 — Room picker on DIRECT check-in · S
**Current:** `hotel/check-in/page.tsx:21` sets `branchId = searchParams.get('branchId')` only; the Hotel PMS "Check-in" tab (`hotel/layout.tsx:16`) links with no branchId, so the backend falls back to the user's SHOP branch → no hotel rooms. **Fix:** resolve the hotel branch on the page (fetch `/branches?type=HOTEL`, auto-select, gate room query) like dashboard/services/categories. **Accept:** direct check-in shows rooms.

### R33 — Payment method at check-out · M
**Current:** Record Guest Payment form hardcodes `method:'CASH'` (`hotel/page.tsx:286`), no bank picker; `addFolioPayment` posts a PAYMENT_IN with no bankAccountId (`hotel.service.ts:689-695`). **Fix:** method (Cash/Bank/UPI/Card) + bank-account select in the form; thread paymentType+bankAccountId to txnCore; store bankAccountId on FolioPayment. **Accept:** guest payment records the chosen method + account.

### R34 — Separate payroll staff (shop vs hotel) · M
**Current:** `getEmployees` unfiltered when branchId undefined → all branches mixed; `generatePayroll` is business-wide; new hires always SHOP (`payroll.service.ts:50-53`); page rides shop-only `activeShopId`, no entity selector. **Fix:** entity selector on payroll page; scope list/create/generate to the selected branch. **Accept:** shop & hotel staff separate; hire lands on selected entity; generate processes only that entity.

### R35 — Fix partial refund + Exchange replacement picker · L
**Current:** `return-dialog.tsx:37-43` pre-checks ALL lines with "checked = return", so selecting one item → allSelected → full refund (the "partial doesn't work" bug); Exchange (`:93`) just issues store credit with no replacement picker. Backend partial path is correct. **Fix:** default NO items selected; add a replacement-item picker + backend `exchangeInvoice` (cash-refund returns + fully-paid replacement sale, backend-computed totals). **Accept:** per-item partial refund works; exchange lets you choose replacements.

### R36 — Remove folio charge / service · M
**Current:** no delete for hotel folio charges (`hotel.service.ts:540`, UI `page.tsx:1107` read-only) or service requests (`services.service.ts`, only forward status). **Fix:** DELETE endpoints (folio charge reverses stock if itemId; service request) + UI remove buttons. **Accept:** added charges/services can be removed.

### R37 — P&L includes hotel + services revenue · M
**Current:** `profitAndLoss` (`reports.service.ts:409-439`) aggregates only SALE_INVOICE/CREDIT_NOTE; hotel checkout posts NO revenue txn (room+folio live on reservation/folio); folio PAYMENT_IN ignored by P&L. **Fix:** add hotel revenue block = Σ(reservation.totalAmount + extraCharges) for CHECKED_OUT reservations in the period (double-count-safe — P&L has zero hotel data today). **Accept:** hotel + service profit shows in P&L.

### Execution order (batch 4)
R32 → R33 → R34 → R35 → R36 → R37.
