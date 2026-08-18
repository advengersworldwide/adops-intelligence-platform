import { describe, it, expect, beforeAll } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptSecret, decryptSecret } from "./secret-crypto";

beforeAll(() => {
  process.env.TOTP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

describe("secret-crypto", () => {
  it("round-trips a secret", () => {
    const secret = "JBSWY3DPEHPK3PXP";
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it("produces different ciphertext each time (random IV)", () => {
    expect(encryptSecret("JBSWY3DPEHPK3PXP")).not.toBe(encryptSecret("JBSWY3DPEHPK3PXP"));
  });

  it("rejects a tampered ciphertext", () => {
    const payload = encryptSecret("JBSWY3DPEHPK3PXP");
    const [iv, tag, ct] = payload.split(":");
    const flipped = Buffer.from(ct, "base64");
    flipped[0] ^= 0xff;
    expect(() => decryptSecret(`${iv}:${tag}:${flipped.toString("base64")}`)).toThrow();
  });

  it("rejects a malformed payload", () => {
    expect(() => decryptSecret("not-a-valid-payload")).toThrow(/Malformed/);
  });

  it("rejects a key of the wrong length", () => {
    const original = process.env.TOTP_ENCRYPTION_KEY;
    process.env.TOTP_ENCRYPTION_KEY = Buffer.from("too-short").toString("base64");
    expect(() => encryptSecret("x")).toThrow(/32 bytes/);
    process.env.TOTP_ENCRYPTION_KEY = original;
  });
});
