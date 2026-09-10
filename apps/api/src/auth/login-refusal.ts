/**
 * The single place that decides whether an account may hold a session, and — when it may not —
 * exactly why. Every gate (login, refresh, password reset, the per-request JWT check) reads it,
 * so a refusal always means the same thing no matter which door it came from.
 *
 * These messages are shown to the person signing in. They are deliberately DIFFERENT from one
 * another: "blocked account" told nobody anything, and every one of these states needs a
 * different action from the shop owner. See loginRefusalReason's callers for when it is safe to
 * show them (only after the password has been proven correct).
 */
export const LOGIN_ERRORS = {
  /** Unknown address, or wrong password. Identical for both, so the form can't enumerate accounts. */
  INVALID: 'Incorrect email or password',
  DEACTIVATED:
    'This account has been deactivated. Ask your Super Admin to enable it again from Settings → Staff management.',
  LOCKED:
    'This account is locked after too many failed sign-in attempts. Ask your Super Admin to unlock it from Settings → Staff management, or to set a new password for you.',
  PENDING:
    'This account is waiting to be approved. Ask your Super Admin to approve it from Settings → Staff management.',
  BUSINESS_SUSPENDED: 'This business account is suspended. Please contact support.',
} as const;

/** How many wrong passwords in a row before the account locks itself. */
export const MAX_FAILED_ATTEMPTS = 5;

/** The account state every gate needs to see. Kept structural so a Prisma row satisfies it as-is. */
export interface LoginGateUser {
  isActive: boolean;
  isApproved: boolean;
  isLocked: boolean;
  business?: { isActive: boolean } | null;
}

/**
 * `null` = this account may sign in. Otherwise the exact, user-facing reason it may not.
 *
 * Order matters only for which message wins when an account is in more than one bad state; the
 * most actionable one comes first.
 *
 * `ignoreLock` is for the password-reset path only. A lockout means "too many wrong passwords",
 * and proving control of the mailbox is precisely how that is meant to be cleared — refusing a
 * reset because the account is locked leaves a business owner (who has nobody above them to
 * unlock it) with no way back in at all.
 */
export function loginRefusalReason(
  user: LoginGateUser,
  opts: { ignoreLock?: boolean } = {},
): string | null {
  if (!user.isActive) return LOGIN_ERRORS.DEACTIVATED;
  if (user.isLocked && !opts.ignoreLock) return LOGIN_ERRORS.LOCKED;
  if (!user.isApproved) return LOGIN_ERRORS.PENDING;
  if (user.business && !user.business.isActive) return LOGIN_ERRORS.BUSINESS_SUSPENDED;
  return null;
}
