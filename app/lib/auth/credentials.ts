import { randomBytes, randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from "./password-policy";

/**
 * 32 characters, excluding I, O, 0 and 1 so users cannot mistranscribe them.
 * Exactly 32 divides 256, so `byte % 32` introduces no modulo bias.
 */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const BACKUP_CODE_COUNT = 10;
const BCRYPT_ROUNDS = 12;

const TEMP_PASSWORD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const TEMP_PASSWORD_LENGTH = 16; // comfortably above the 12-char minimum

export function generateBackupCodes(count: number = BACKUP_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    const bytes = randomBytes(8);
    const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
    codes.add(`${chars.slice(0, 4)}-${chars.slice(4, 8)}`);
  }
  return [...codes];
}

/** Strips spaces and dashes and uppercases, so user transcription is forgiving. */
export function normalizeBackupCode(code: string): string {
  return code.replace(/[\s-]/g, "").toUpperCase();
}

export function hashBackupCode(code: string): Promise<string> {
  return bcrypt.hash(normalizeBackupCode(code), BCRYPT_ROUNDS);
}

export function verifyBackupCode(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(normalizeBackupCode(code), hash);
}

/** `randomInt` is rejection-sampled, so this is unbiased across the alphabet. */
export function generateTempPassword(length: number = TEMP_PASSWORD_LENGTH): string {
  return Array.from(
    { length },
    () => TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)],
  ).join("");
}
