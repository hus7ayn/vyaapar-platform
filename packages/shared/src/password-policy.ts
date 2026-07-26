export const PASSWORD_MIN_LENGTH = 8;

// At least one lowercase, one uppercase, one digit and one special character —
// enforced on signup/reset/change, not on login (existing accounts predate this
// rule and shouldn't be locked out retroactively).
export const PASSWORD_COMPLEXITY_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/;

export const PASSWORD_POLICY_MESSAGE =
  `Password must be at least ${PASSWORD_MIN_LENGTH} characters and include uppercase and lowercase letters, a number, and a special character`;

export function isStrongPassword(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH && PASSWORD_COMPLEXITY_REGEX.test(password);
}
