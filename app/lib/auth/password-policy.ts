import { createHash } from "node:crypto";

export const MIN_PASSWORD_LENGTH = 12;
/**
 * bcrypt silently truncates input at 72 bytes. Without an explicit cap, two
 * different long passphrases sharing a 72-byte prefix authenticate each other.
 * Rejecting is safer than truncating.
 */
export const MAX_PASSWORD_LENGTH = 72;

const HIBP_RANGE_URL = "https://api.pwnedpasswords.com/range";
const HIBP_TIMEOUT_MS = 2000;

export interface PasswordValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Checks the password against HaveIBeenPwned using k-anonymity: only the first
 * five characters of the SHA-1 hash are sent. The password never leaves this
 * process.
 *
 * Fails OPEN — a third-party outage must not block password changes.
 */
export async function isBreached(password: string): Promise<boolean> {
  const hash = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);

  try {
    const res = await fetch(`${HIBP_RANGE_URL}/${prefix}`, {
      signal: AbortSignal.timeout(HIBP_TIMEOUT_MS),
      headers: { "Add-Padding": "true" },
    });
    if (!res.ok) {
      console.warn(`[password-policy] breach check returned ${res.status}; failing open`);
      return false;
    }
    const body = await res.text();
    return body
      .split("\n")
      .some((line) => line.split(":")[0]?.trim().toUpperCase() === suffix);
  } catch (err) {
    console.warn("[password-policy] breach check unavailable; failing open", err);
    return false;
  }
}

export async function validatePassword(password: string): Promise<PasswordValidationResult> {
  const errors: string[] = [];

  if (password.length < MIN_PASSWORD_LENGTH) {
    errors.push(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_LENGTH) {
    errors.push(`Password must be at most ${MAX_PASSWORD_LENGTH} characters.`);
  }

  // Only spend a network call on a password that is otherwise acceptable.
  if (errors.length === 0 && (await isBreached(password))) {
    errors.push("This password has appeared in a known data breach. Choose a different one.");
  }

  return { ok: errors.length === 0, errors };
}
