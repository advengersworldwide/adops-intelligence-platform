import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12; // GCM standard nonce length

function getKey(): Buffer {
  const raw = process.env.TOTP_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("TOTP_ENCRYPTION_KEY environment variable is required");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("TOTP_ENCRYPTION_KEY must decode to exactly 32 bytes (base64-encoded)");
  }
  return key;
}

/** Returns "iv:authTag:ciphertext", each segment base64. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted secret");
  }
  const [ivB64, tagB64, ctB64] = parts;
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * `decryptSecret` throws when the AES-GCM auth tag fails to verify — e.g. if
 * TOTP_ENCRYPTION_KEY was rotated since a secret was written, or the stored
 * row is corrupt. That is a server-side condition, not evidence a submitted
 * code is wrong, but per "failures stay generic" callers must not let it
 * surface as a 500: this treats it the same as an invalid code, logging a
 * server-side-only signal so a key rotation shows up as a warning spike
 * instead of an unexplained wave of generic lockouts.
 *
 * `logPrefix` tags the warning with the calling route (e.g. `"login/2fa"`,
 * `"2fa/enable"`, `"2fa/disable"`) so the three call sites stay distinguishable
 * in logs despite sharing this one implementation.
 */
export function tryDecryptSecret(payload: string, logPrefix: string): string | null {
  try {
    return decryptSecret(payload);
  } catch (err) {
    console.warn(`[${logPrefix}] decryptSecret failed; treating TOTP as invalid`, err);
    return null;
  }
}
