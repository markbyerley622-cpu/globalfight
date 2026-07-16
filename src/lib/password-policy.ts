// Password strength policy — one definition, used by signup, change, and reset
// so the three can't drift apart.

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 200; // bcrypt truncates at 72 bytes; cap input to bound hashing cost

/**
 * A small deny-list of passwords that meet the length rule but are the first
 * thing an attacker tries. Not a substitute for length — a supplement to it.
 */
const COMMON = new Set([
  "password12", "password123", "1234567890", "qwertyuiop", "letmein123",
  "iloveyou12", "administrator", "combatregister", "changeme123",
]);

export type PasswordProblem = string | null;

/** Returns null when acceptable, otherwise a user-facing reason. */
export function checkPassword(password: string): PasswordProblem {
  if (typeof password !== "string" || password.length === 0) return "Enter a new password.";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password must be under ${MAX_PASSWORD_LENGTH} characters.`;
  }
  if (COMMON.has(password.toLowerCase())) return "That password is too common. Choose something less predictable.";
  // Require some variety rather than a rigid character-class rule: length plus
  // "not all one character" beats "must contain a symbol" for real-world strength.
  if (new Set(password).size < 5) return "Password is too repetitive. Choose something less predictable.";
  return null;
}
