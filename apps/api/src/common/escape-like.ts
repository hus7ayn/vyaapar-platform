/**
 * Make a user-supplied value safe to use with Prisma's `mode: 'insensitive'`.
 *
 * On PostgreSQL, Prisma compiles `equals` + `mode: 'insensitive'` to `ILIKE $1` — NOT to an
 * equality test. In an ILIKE pattern `%` matches any run of characters and `_` matches any single
 * character, so passing an address straight through turns an identity lookup into a pattern match:
 * `"%@gmail.com"` matches every gmail account in the database, across every tenant. That let a
 * caller mint password-reset codes for strangers and drive unrelated accounts into their
 * failed-attempt lockout.
 *
 * Backslash is ILIKE's default escape character, so escaping the three metacharacters makes the
 * value match only itself — while keeping the case-insensitivity we actually wanted. An address
 * that genuinely contains `_` (mary_k@shop.com) still matches itself and nothing else.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** An `equals` filter that is case-insensitive but cannot be used as a wildcard pattern. */
export function insensitiveEquals(value: string) {
  return { equals: escapeLike(value), mode: 'insensitive' as const };
}
