import * as OTPAuth from "otpauth";

export const TOTP_PERIOD = 30;
const TOTP_DIGITS = 6;
const TOTP_ALGORITHM = "SHA1"; // what authenticator apps actually implement
const ISSUER = "AdOps Intelligence";
/** ±1 step of tolerance for clock drift between server and phone. */
const DRIFT_WINDOW = 1;

export function generateSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

function buildTotp(secret: string, accountLabel: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label: accountLabel,
    algorithm: TOTP_ALGORITHM,
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}

export function buildOtpauthUri(secret: string, accountLabel: string): string {
  return buildTotp(secret, accountLabel).toString();
}

/** The TOTP time step for a given wall-clock time. */
export function currentStep(now: number = Date.now()): number {
  return Math.floor(now / 1000 / TOTP_PERIOD);
}

/** Only used by tests and never by production code. */
export function generateCode(secret: string, now: number = Date.now()): string {
  return buildTotp(secret, "test").generate({ timestamp: now });
}

/**
 * Verifies a code and returns the time step it belongs to, so the caller can
 * record it. `lastStep` is the most recently consumed step for this user;
 * any code at or below it is a replay and is rejected even if cryptographically
 * valid, because a code stays valid for the remainder of its 30-second window.
 */
export function verifyTotp(
  secret: string,
  code: string,
  lastStep: number | null,
  now: number = Date.now(),
): { valid: boolean; step: number | null } {
  const normalized = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) return { valid: false, step: null };

  const delta = buildTotp(secret, "verify").validate({
    token: normalized,
    window: DRIFT_WINDOW,
    timestamp: now,
  });
  if (delta === null) return { valid: false, step: null };

  const step = currentStep(now) + delta;
  if (lastStep !== null && step <= lastStep) return { valid: false, step: null };

  return { valid: true, step };
}
