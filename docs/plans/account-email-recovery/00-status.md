# Status: Account recovery — Super Admin self-reset, staff reset by the owner

- Gate 1 — Product: APPROVED 2026-08-08
- Gate 2 — Architecture: APPROVED 2026-08-09
- Gate 3 — Program Design: APPROVED 2026-08-09
- Gate 4 — Slice plan: APPROVED 2026-08-09

## Slices
- [x] Slice 1 — tracer bullet: mail module + console driver + templates; forgot-password renders a real email to the log
- [x] Slice 2 — happy path: schema, real codes bound to userId, SELF_RESET_ROLES filter, reset signs the owner in, web page rewritten
- [x] Slice 3 — hard edges: non-enumeration, throttling, wrong/expired/replayed codes, assertLoginAllowed
- [x] Slice 4 — confirm the recovery address: resend + confirm, /verify-email page, banner in settings/account
- [x] Slice 5 — owner sets a staff password: endpoint, guards, session revoke, Users dialog
- [x] Slice 6 — retire the old path: delete otp/* and reset keys, update env, tests

## What is proven, and what is not

**Proven.** 22 jest tests pass (`apps/api` — `mail.spec.ts`, `auth.spec.ts`), covering template
rendering and escaping, driver selection and fallback, the never-throw contract on send, the
SELF_RESET_ROLES membership that the whole design turns on, six-digit code generation including
leading zeros, and token hashing. All of them fail against the pre-change code. Both apps
typecheck clean; web lint is clean bar three pre-existing `exhaustive-deps` warnings.

**Not proven.** Nothing has been exercised against a running API — Docker was not available in
the session that built this, so no request ever reached the new endpoints and no migration has
been applied to a real database. Specifically unrun:

- the migration `20260809000000_account_recovery` (hand-written, never applied)
- every HTTP path: forgot-password, reset-password, verify-email/{status,resend,confirm},
  users/:id/set-password
- the account-recovery block added to `scripts/e2e-smoke.mjs` (syntax-checked only)

To finish verification: start Docker, `pnpm docker:up`, apply the migration, seed, run the API,
then `pnpm test:e2e`. A local Postgres was seen listening on 5432, but the project expects
Docker's on 5433.

## Deviation from Gate 3

`GET /auth/verify-email/status` was added and is not in `03-program-design.md`. The banner needs
to know whether the caller's address is confirmed, and nothing exposed that: the login response
carries no such field, and reading it from the token would leave the banner stale until the next
login. It returns `{ required, verified, email }` for the caller only.

## Left alone deliberately

`ralph/prd.json` and `ralph/progress.txt` still describe the reset-key design. They are the log of
an earlier automated run — a record of what was true then, not live configuration. Rewriting them
would falsify history; they are superseded by these documents.

## Notes for a fresh session

Covers issues A2 (no email verification) and A3 (no OTP received) from `Issues.txt`.

Established during triage, before Gate 1:

- Public self-service signup was removed (`auth.controller.ts:22`). Accounts are created by
  an admin, so "verify at signup" really means "verify an address the owner typed for someone else."
- The OTP already exists and is stored (`OtpCode` table), but `auth.service.ts:163` only does
  `console.log('[OTP] ...')`. No mail or SMS provider is configured anywhere in the repo.
- There is an existing escape hatch: `resetPassword(email, roleKey, newPassword)` verifies the
  account with a role-specific reset key instead of a delivered code. Generic errors on failure,
  so it doesn't leak which accounts exist.
- Strong-password rules are already enforced (`IsStrongPassword` on signup/reset/change DTOs),
  and `POST /auth/change-password` plus a UI at `settings/account` already exist.

Scope was narrowed by the user during Gate 1, after the first draft was written: **only the Super
Admin gets a self-service forgot-password, and the code goes to that Super Admin's own email.**
Everyone else is reset by the Super Admin from the Users screen. Address confirmation therefore
narrowed to the Super Admin's address alone — nothing is ever emailed to staff. The first draft
(verify every user, everyone self-resets) is superseded; don't reinstate it.

Gate 1 left one question open, assumed **no** unless the user says otherwise: an Admin may *not*
set a Biller's password — only the Super Admin can.

Also confirmed by reading the code during Gate 1: there is **no** admin-set-password endpoint
today (`users.controller.ts` has create / update / status / approve / delete only), so the staff
half of this feature is new work rather than a UI on top of something existing.

Six unrelated quick fixes were completed before this plan started (barcode lock-down, item
discount ₹/%, reminder date picker, invoice filter validation, expense party required, POS
services clickable). They are not part of this feature.
