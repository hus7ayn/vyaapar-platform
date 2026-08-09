# Program Design: Account recovery

Role names below are **code** roles. `ADMIN` is the shop owner the UI calls "Super Admin" — see the
naming table at the top of `02-architecture.md`.

## Files

**New — API**

| File | Why it lives there |
|---|---|
| `apps/api/src/mail/mail.module.ts` | Wraps the sender so `auth` imports one module, not a provider |
| `apps/api/src/mail/mail.service.ts` | Picks a driver from `MAIL_DRIVER` and swallows delivery failure |
| `apps/api/src/mail/mail.types.ts` | `MailMessage` / `MailDriver` — shared by service, drivers and templates |
| `apps/api/src/mail/drivers/console.driver.ts` | The default. Prints the mail; keeps every unconfigured environment working |
| `apps/api/src/mail/drivers/http.driver.ts` | Production sender over the provider's HTTPS API — no SMTP socket on serverless |
| `apps/api/src/mail/templates.ts` | Subject + HTML + plaintext per mail, as pure functions so they're unit-testable without sending |

**Changed — API**

| File | Change |
|---|---|
| `apps/api/prisma/schema.prisma` | `User.emailVerifiedAt` + `@@index([email])`; `OtpCode.userId`/`purpose`; new `EmailVerificationToken` |
| `apps/api/src/auth/auth.service.ts` | Add the four flows; delete `requestOtp`, `verifyOtp`, `resetKeyForRole` and key-based `resetPassword` |
| `apps/api/src/auth/auth.controller.ts` | Re-point `forgot-password`/`reset-password`, drop both `otp/*` routes, add the two `verify-email/*` routes, add per-route throttling |
| `apps/api/src/auth/dto/auth.dto.ts` | New DTOs; `ResetPasswordDto` loses `roleKey`, gains `code` |
| `apps/api/src/auth/auth.module.ts` | Import `MailModule` |
| `apps/api/src/users/users.controller.ts` | `POST :id/set-password` |
| `apps/api/src/users/users.service.ts` | `setPassword` |
| `apps/api/src/users/dto/create-user.dto.ts` | Add `SetUserPasswordDto` beside the existing DTO |
| `apps/api/src/app.module.ts` | Register `MailModule` |
| `.env.example` | Add the four mail keys; delete the three reset-key entries |

**Changed — web**

| File | Change |
|---|---|
| `apps/web/src/app/(auth)/forgot-password/page.tsx` | Replace the reset-key form with request-code → enter-code |
| `apps/web/src/app/(auth)/verify-email/page.tsx` | **New.** Reads `?token=`, confirms, sends them to login |
| `apps/web/src/app/(app)/settings/account/page.tsx` | Unconfirmed-address banner + Resend, `ADMIN`/`SUPER_ADMIN` only |
| `apps/web/src/app/(app)/settings/users/page.tsx` | Set password action + dialog |

**Changed — tests**

| File | Change |
|---|---|
| `apps/api/test/auth.spec.ts` | Extend — it already exists and holds pure-logic RBAC assertions |
| `apps/api/test/mail.spec.ts` | **New.** Template rendering + driver selection |
| `scripts/e2e-smoke.mjs` | Drive the reset end to end against a live API using the console driver |

## Types & signatures

```ts
// apps/api/src/mail/mail.types.ts
export interface MailMessage { to: string; subject: string; html: string; text: string }

export interface MailDriver {
  readonly name: string;
  send(message: MailMessage): Promise<void>;
}
```

```ts
// apps/api/src/mail/templates.ts — pure, so they can be asserted without sending anything
export type MailBody = Omit<MailMessage, 'to'>;

export function resetCodeEmail(input: {
  firstName: string; businessName: string; code: string; expiresInMinutes: number;
}): MailBody;

export function verifyAddressEmail(input: {
  firstName: string; businessName: string; link: string; expiresInHours: number;
}): MailBody;
```

```ts
// apps/api/src/mail/mail.service.ts
@Injectable()
export class MailService {
  constructor();
  /** Resolved once from MAIL_DRIVER; `console` when unset. */
  readonly driverName: string;
  /** Never rejects. A delivery failure is logged, never returned — it must not become an oracle. */
  send(message: MailMessage): Promise<void>;
}
```

```ts
// apps/api/src/auth/auth.service.ts

/** Roles with nobody above them, so the system itself has to let them back in. */
export const SELF_RESET_ROLES: readonly string[];

/** Always the same shape, whatever the address — see architecture finding 3. */
async forgotPassword(email: string): Promise<{ message: string }>;

/** Consumes the code, sets the password, kills sessions, confirms the address, signs them in. */
async resetPasswordWithCode(email: string, code: string, newPassword: string): Promise<AuthTokens>;

async resendVerificationEmail(userId: string): Promise<{ message: string }>;

async confirmEmail(token: string): Promise<{ message: string }>;

private async sendVerificationEmail(user: {
  id: string; email: string; firstName: string; business: { name: string };
}): Promise<void>;

private static generateOtpCode(): string;      // six digits, crypto random
private static generateVerificationToken(): { token: string; tokenHash: string };
private static hashToken(token: string): string;

// deleted: requestOtp, verifyOtp, resetPassword(email, roleKey, newPassword), resetKeyForRole
```

```ts
// apps/api/src/users/users.service.ts
/** Owner sets a staff password. Throws if target is self, cross-business, or a self-reset role. */
async setPassword(
  businessId: string,
  targetUserId: string,
  caller: { id: string; role: string },
  newPassword: string,
): Promise<{ message: string }>;
```

```ts
// apps/api/src/auth/dto/auth.dto.ts
export class ForgotPasswordDto { @IsEmail() email!: string }

export class ResetPasswordDto {
  @IsEmail() email!: string;
  @Matches(/^\d{6}$/, { message: 'Enter the six-digit code from your email' }) code!: string;
  @IsStrongPassword() newPassword!: string;
}

export class ConfirmEmailDto { @IsString() @MinLength(32) token!: string }

// apps/api/src/users/dto/create-user.dto.ts
export class SetUserPasswordDto { @IsStrongPassword() newPassword!: string }
```

```prisma
model User {
  emailVerifiedAt DateTime? @map("email_verified_at")   // null = unconfirmed; no backfill needed
  otpCodes           OtpCode[]
  verificationTokens EmailVerificationToken[]
  @@index([email])                                       // forgot-password looks up across businesses
}

model OtpCode {
  userId  String @map("user_id")                         // codes bind to an account, not an address
  purpose String @default("PASSWORD_RESET")
  user    User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
}

model EmailVerificationToken {
  id        String    @id @default(uuid())
  userId    String    @map("user_id")
  tokenHash String    @unique @map("token_hash")         // only the hash — a leaked row is not a link
  expiresAt DateTime  @map("expires_at")
  usedAt    DateTime? @map("used_at")
  createdAt DateTime  @default(now()) @map("created_at")
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
  @@map("email_verification_tokens")
}
```

## Call stack

**Forgot password**

```
POST /auth/forgot-password            @Throttle 5/hour per IP
  AuthController.forgotPassword(ForgotPasswordDto)
    AuthService.forgotPassword(email)
      prisma.user.findMany  { email, deletedAt: null, role in SELF_RESET_ROLES }  include business
      for each match:
        AuthService.generateOtpCode()
        prisma.otpCode.create   { userId, email, code, purpose, expiresAt: +10min }
        templates.resetCodeEmail({ firstName, businessName, code, expiresInMinutes })
        MailService.send(...)                       // awaited; failure logged, not thrown
      return { message: GENERIC_RESET_REPLY }       // identical when there were zero matches
```

**Reset with the code**

```
POST /auth/reset-password             @Throttle 10/hour per IP
  AuthController.resetPassword(ResetPasswordDto)
    AuthService.resetPasswordWithCode(email, code, newPassword)
      prisma.otpCode.findFirst { code, used: false, purpose, expiresAt gt now, user: { email, deletedAt: null } }
        └ none → UnauthorizedException('Invalid or expired code')
      assertLoginAllowed(otp.user)                  // reuses the existing gate
      bcrypt.hash(newPassword, 12)
      prisma.$transaction([
        otpCode.update      { used: true },
        user.update         { passwordHash, failedAttempts: 0, isLocked: false,
                              emailVerifiedAt: existing ?? now },   // the code proves reachability
        session.deleteMany  { userId },
      ])
      issueTokens(...)                              // lands signed in, as the mockup shows
```

**Confirm the address**

```
POST /auth/verify-email/resend        authenticated, self only
  AuthService.resendVerificationEmail(userId)
    guard role in SELF_RESET_ROLES, else BadRequest   // staff addresses are never sent to
    already verified → return early, send nothing
    sendVerificationEmail(user) → generateVerificationToken → store hash → templates.verifyAddressEmail
      link = `${WEB_URL}/verify-email?token=<raw token>`

POST /auth/verify-email/confirm       public
  AuthService.confirmEmail(token)
    hashToken(token) → emailVerificationToken.findUnique({ tokenHash })
    reject when missing / usedAt set / expired
    prisma.$transaction([ token.update { usedAt: now }, user.update { emailVerifiedAt: now } ])
```

**Owner sets a staff password**

```
POST /users/:id/set-password          @RequirePermissions(USER_MANAGE)
  UsersController.setPassword(businessId, id, caller, SetUserPasswordDto)
    UsersService.setPassword(businessId, targetUserId, caller, newPassword)
      caller.role in SELF_RESET_ROLES        else ForbiddenException
      target = user.findFirst { id, businessId, deletedAt: null }   else NotFound
      target.id === caller.id                → BadRequest('Use Change password')
      target.role in SELF_RESET_ROLES        → Forbidden (an owner can't seize another owner)
      bcrypt.hash(newPassword, 12)
      prisma.$transaction([ user.update { passwordHash, failedAttempts: 0, isLocked: false },
                            session.deleteMany { userId: target.id } ])
      audit log
```

## Test plan

**`apps/api/test/mail.spec.ts`** — pure, no database

- `resetCodeEmail puts the code in both the HTML and the plaintext part` — asserts the six digits
  appear in `html` and `text`, because a text-only client must still be usable.
- `resetCodeEmail names the business` — two businesses sharing one address produce two mails; if
  the body doesn't say which shop, the recipient can't tell them apart.
- `verifyAddressEmail embeds the link verbatim` — asserts the exact `WEB_URL` + `?token=` string,
  since a mangled link is the failure the user cannot work around.
- `MailService defaults to the console driver when MAIL_DRIVER is unset` — the promise in the
  architecture that an unconfigured environment keeps working.
- `MailService.send resolves when the driver throws` — a bounced mail must not fail the request,
  or the response leaks which addresses exist.

**`apps/api/test/auth.spec.ts`** — extended, pure

- `SELF_RESET_ROLES contains ADMIN and SUPER_ADMIN` — the naming trap from Gate 2, pinned.
- `SELF_RESET_ROLES excludes BRANCH_MANAGER, BILLER and ACCOUNTANT` — fails if someone "helpfully"
  widens it later.
- `generateOtpCode always returns six digits` — over many iterations, asserting no leading-zero
  loss (`Math.random()`-style formatting bugs drop them).
- `generateVerificationToken never returns the raw token as its hash` — the stored value must not
  be usable as a link.
- `hashToken is stable for one input and differs across inputs`.

**`scripts/e2e-smoke.mjs`** — against a live API with `MAIL_DRIVER=console`

- `forgot-password for a BILLER creates no code` — asserts the reply is byte-identical to the
  owner's, and that no `OtpCode` row was created. This is the whole product decision in one test.
- `forgot-password for an unknown address returns the same reply` — no enumeration.
- `reset with a wrong code is rejected` and `a used code cannot be replayed`.
- `reset with the right code signs the owner in and the old password stops working` — the actual
  user-visible promise.
- `reset sets emailVerifiedAt when it was null`.
- `set-password lets the owner in as a biller, and revokes that biller's existing session`.
- `set-password on another ADMIN is refused`.

Each of these fails against today's code — none can pass before the work is done.

## Least confident decisions

1. **Deleting `otp/request` and `otp/verify` outright** rather than leaving them behind a flag.
   Nothing in `apps/web` calls them, but a mobile or desktop build outside this repo might. Cheap
   to soften now (keep the routes, refuse for non-self-reset roles), expensive after release.
2. **A reset code also confirming the address.** Elegant — receiving it *is* proof of reach — but
   it means an owner who never clicks the link is silently marked confirmed. If you'd rather the
   banner only clear on a real click, say so.
3. **Sending one code per matching account** when an address owns accounts in two businesses. The
   alternative is to refuse and tell them to contact support. Two near-identical emails arriving at
   once is confusing; being unable to reset at all is worse.
4. **`@Throttle 5/hour` on forgot-password.** Tight enough to stop mail-bombing an inbox, loose
   enough for a genuinely confused owner. It's a guess, and the global limit today is 100/minute.
5. **Refusing to let one `ADMIN` set another `ADMIN`'s password.** Safe, but a two-owner shop where
   one is away now has no in-app path — they'd fall back to the email reset, which is exactly what
   this feature makes work, so I think it holds.
6. **No dedicated `password-reset` audit entry** in the plan beyond the existing audit log usage in
   `users`. If you want a visible security trail of who reset what and when, that's worth adding
   now rather than after an incident.
