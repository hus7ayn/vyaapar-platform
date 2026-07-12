export const PASSWORD_MIN_LENGTH = 8;

// At least one letter and one number — enforced on signup/reset, not on login
// (existing accounts predate this rule and shouldn't be locked out retroactively).
export const PASSWORD_COMPLEXITY_REGEX = /^(?=.*[A-Za-z])(?=.*\d).+$/;

export const PASSWORD_POLICY_MESSAGE =
  `Password must be at least ${PASSWORD_MIN_LENGTH} characters and include a letter and a number`;

export function isStrongPassword(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH && PASSWORD_COMPLEXITY_REGEX.test(password);
}
