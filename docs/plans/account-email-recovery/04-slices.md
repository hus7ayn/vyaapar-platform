# Vertical slices: Account recovery

Build order. Each slice ends in something that runs and can be shown.

1. **Tracer bullet — a real email, rendered end to end.** `MailModule` + console driver +
   both templates + `MAIL_DRIVER` config, wired into `forgot-password`. The code is hardcoded and
   nothing is stored. Proof: `curl` the endpoint, watch a fully-rendered email appear in the API log.

2. **The happy path.** Schema migration (`User.emailVerifiedAt` + `@@index([email])`,
   `OtpCode.userId`/`purpose`, `EmailVerificationToken`), real six-digit codes bound to a `userId`,
   the `SELF_RESET_ROLES` filter, and `reset-password` consuming a code to set the password and
   sign the owner in. Web forgot-password page rewritten to request-code → enter-code. Proof: reset
   an owner's password in the browser and land inside the app.

3. **The hard edges.** Identical reply for unknown addresses and non-eligible roles, per-route
   throttling, and rejection of wrong / expired / already-used codes, plus `assertLoginAllowed` on
   the reset path. Proof: a biller gets a byte-identical reply and no code row is written.

4. **Confirm the recovery address.** `verify-email/resend` + `verify-email/confirm`, the
   `/verify-email` page, and the banner in `settings/account`. Proof: banner → email → click →
   banner gone.

5. **The owner sets a staff password.** `POST /users/:id/set-password` with its guards and session
   revocation, and the Set password dialog on the Users screen. Proof: reset a biller, watch their
   existing session stop working.

6. **Retire the old path.** Delete `otp/request`, `otp/verify`, `resetKeyForRole` and the key-based
   `resetPassword`; drop the three `*_RESET_KEY` env vars; update `.env.example` and `README.md`.
   Add `mail.spec.ts`, extend `auth.spec.ts`, extend `e2e-smoke.mjs`. Proof: the suites pass and no
   reference to a reset key survives.

## Decisions carried in from Gate 3's "least confident" list

- **1 — delete `otp/*` outright.** Confirmed safe: nothing in `apps/web` calls them, and
  `apps/desktop` is an Electron shell that loads the web app and makes no auth calls of its own.
- **2 — a reset code also confirms the address.** Kept.
- **6 — no dedicated password-reset audit entry** beyond the existing audit usage. Kept.
