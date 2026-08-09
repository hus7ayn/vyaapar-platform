# Architecture: Account recovery

## Naming — read this first

The word "Super Admin" means different things in the UI and in the code. From
`packages/shared/src/roles.ts`:

| Code role | Label the user sees | Who it is |
|---|---|---|
| `SUPER_ADMIN` | **Platform Admin** | us, the people running the platform |
| `ADMIN` | **Super Admin** | the business owner — the shop |
| `BRANCH_MANAGER` | **Admin** | shop-scoped manager |
| `BILLER` | Biller | counter staff |

So the "Super Admin" in `01-product.md` — the shop owner with nobody above them — is the code role
**`ADMIN`**. Everything below uses code role names.

**Self-reset roles: `ADMIN` and `SUPER_ADMIN`.** The shop owner because the product says so; the
platform admin because they likewise have nobody above them to reset their password.

## Fit

- **`auth` module** (`auth.service.ts`, `auth.controller.ts`, `dto/auth.dto.ts`) — owns the reset
  and address-confirmation flows. Already holds `requestOtp` / `verifyOtp` / `resetPassword`.
- **`users` module** (`users.controller.ts`, `users.service.ts`) — gains the one thing it lacks:
  setting another user's password. It already creates users with a bcrypt hash at cost 12, so the
  hashing convention is established.
- **New `mail` module** — a `MailService` with a driver behind it: a console driver for local work
  (what happens today, but deliberate) and an HTTP-API driver for production. Injected into `auth`.
- **`prisma/schema.prisma`** — three changes, listed under Data.
- **web** — the forgot/reset screens, a banner in `settings/account`, and a Set password action in
  `settings/users`.

Untouched on purpose: `login`, `refresh`, `change-password` and `assertLoginAllowed` all keep
working exactly as they do now.

## Three things found in the code that shape this design

**1. `POST /auth/otp/request` + `/auth/otp/verify` are a dormant passwordless login.** `verifyOtp`
does not reset anything — it calls `issueTokens` and signs the user straight in, for *any* role.
Nothing in the web app calls either route; they survive only because the code is written to a log
and never delivered. **Wiring up real email would silently switch on passwordless email login for
every biller in the system** — the exact opposite of the approved design. `verifyOtp` therefore
stops minting tokens and the OTP becomes reset-only.

**2. An email address is not globally unique** — `@@unique([businessId, email])`. The same address
can own accounts in two businesses, and today `requestOtp` does `findFirst({ where: { email } })`,
which picks one arbitrarily. Codes are therefore bound to a `userId`, not to an address, and a
request that matches two eligible accounts sends one email per account, each naming its business.

**3. `requestOtp` leaks which accounts exist** — it throws `User not found` for an unknown address
while returning success for a known one. Product decision 6 forbids this; the reply becomes
identical in every case.

## Endpoints

Changed:

- `POST /auth/forgot-password` — issues a code only for a self-reset role; always returns the same
  generic body, whatever the address. Now actually sends mail.
- `POST /auth/reset-password` — was `{ email, roleKey, newPassword }` against a shared per-role env
  key. Becomes `{ email, code, newPassword }`. The shared-key path and `resetKeyForRole` are deleted.
- `POST /auth/otp/verify` — no longer returns tokens; folded into reset-password. Route removed.
- `POST /auth/otp/request` — route removed; `forgot-password` is the only way to ask for a code.

New:

- `POST /auth/verify-email/resend` — authenticated, self only. Re-sends the confirmation link.
- `POST /auth/verify-email/confirm` — public, `{ token }`. Marks the address confirmed.
- `POST /users/:id/set-password` — `ADMIN`/`SUPER_ADMIN` only, same business, never self. Sets a
  staff password and revokes that user's sessions.

## Data

`User`

- `emailVerifiedAt DateTime? @map("email_verified_at")` — null means unconfirmed. Nullable, so
  every existing row stays valid with no backfill.

`OtpCode` — currently keyed by a bare email with no purpose and no owner.

- add `userId String @map("user_id")` + relation + index — fixes finding 2.
- add `purpose String @default("PASSWORD_RESET")` — so a future OTP use can't be spent here.
- keep `email`, `code`, `expiresAt`, `used`, `createdAt` as they are.

`EmailVerificationToken` — new. A confirmation link is a long random secret with a 24-hour life,
not a 6-digit code, so it does not belong in `OtpCode`.

- `id`, `userId` (+ index), `tokenHash`, `expiresAt`, `usedAt DateTime?`, `createdAt`.
- Only the hash is stored: a leaked database row must not be a working confirmation link.

Queries these add: look up eligible users by email (indexed by `[businessId, email]`, so this one
is a scan on `email` — add `@@index([email])` to `User`); find an unused unexpired code by value;
find a token by hash; update user password + delete that user's sessions in one transaction, the
pattern `changePassword` already uses.

## Flow

**Owner forgets their password**

1. web → `POST /auth/forgot-password { email }`
2. `AuthService` finds every non-deleted user with that address whose role is `ADMIN` or
   `SUPER_ADMIN`. None → return the generic body and stop.
3. For each match: create an `OtpCode` bound to that `userId`, six digits, ten minutes.
4. `MailService.sendResetCode(...)` per match, naming the business. Delivery failure is logged,
   never surfaced — the response cannot become an oracle for which addresses exist.
5. Generic body either way.
6. web → `POST /auth/reset-password { email, code, newPassword }`
7. Match the code → its `userId`. Mark used. In one transaction: write the new hash, clear
   `failedAttempts`/`isLocked`, delete every session for that user, and set `emailVerifiedAt` if
   it is null — receiving the code *is* proof the address reaches them.
8. `assertLoginAllowed`, then `issueTokens` — they land signed in, as the mockup shows.

**Confirming the recovery address**

1. Owner sees the banner while `emailVerifiedAt` is null → `POST /auth/verify-email/resend`.
2. Random token generated, hash stored, link mailed as `{WEB_URL}/verify-email?token=…`.
3. That page → `POST /auth/verify-email/confirm { token }` → hash, match, check expiry and unused,
   set `usedAt` and `emailVerifiedAt`.

**Owner sets a staff password**

1. `POST /users/:id/set-password { newPassword }`
2. Guard: caller is `ADMIN`/`SUPER_ADMIN`; target is in the caller's business; target is not the
   caller (that is `change-password`); target is not another `ADMIN`/`SUPER_ADMIN`.
3. Hash at cost 12, delete the target's sessions, write an audit row.
4. Nothing is emailed — the mockup says the owner tells them in person.

## External

An email provider, reached over HTTPS rather than SMTP: the API runs as a single Vercel serverless
function, where a short HTTP call fits the request budget and a held-open SMTP connection does not.

Env var names — values never live in the repo:

- `MAIL_DRIVER` — `console` (default, local) or the provider's name
- `MAIL_API_KEY`
- `MAIL_FROM` — e.g. a no-reply address on a domain we control
- `WEB_URL` — already exists in `.env.example`; used to build the confirmation link

`console` being the default matters: with nothing configured the system behaves exactly as it does
today, so no environment breaks by deploying this.

**Deliverability is the real risk, not the code.** A brand-new sending domain lands in spam until
SPF and DKIM are published for it. The provider account, the domain records and a test send to a
Gmail address are prerequisites for the metric in `01-product.md`, not follow-up work.

## Deleted by this work

- `resetKeyForRole` and the `SUPER_ADMIN_RESET_KEY` / `ADMIN_RESET_KEY` / `BILLER_RESET_KEY` env
  vars — a shared secret per role that never rotates (product decision 7).
- `verifyOtp`'s token-minting path, and both `otp/*` routes.
