import { describe, it, expect } from "vitest";
import {
  generateBackupCodes,
  hashBackupCode,
  verifyBackupCode,
  normalizeBackupCode,
  generateTempPassword,
} from "./credentials";
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from "./password-policy";

describe("backup codes", () => {
  it("generates ten unique codes by default", () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
  });

  it("formats codes as XXXX-XXXX with no ambiguous characters", () => {
    for (const code of generateBackupCodes()) {
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    }
  });

  it("round-trips hash and verify", async () => {
    const [code] = generateBackupCodes(1);
    const hash = await hashBackupCode(code);
    await expect(verifyBackupCode(code, hash)).resolves.toBe(true);
  });

  it("rejects a different code", async () => {
    const [a, b] = generateBackupCodes(2);
    await expect(verifyBackupCode(b, await hashBackupCode(a))).resolves.toBe(false);
  });

  it("verifies regardless of case, spaces, or dashes", async () => {
    const [code] = generateBackupCodes(1);
    const hash = await hashBackupCode(code);
    const messy = ` ${code.toLowerCase().replace("-", " ")} `;
    await expect(verifyBackupCode(messy, hash)).resolves.toBe(true);
  });

  it("normalizes to uppercase without separators", () => {
    expect(normalizeBackupCode(" ab2c-d3ef ")).toBe("AB2CD3EF");
  });
});

describe("temp passwords", () => {
  it("satisfies the length policy", () => {
    const pw = generateTempPassword();
    expect(pw.length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
    expect(pw.length).toBeLessThanOrEqual(MAX_PASSWORD_LENGTH);
  });

  it("is different every time", () => {
    const generated = new Set(Array.from({ length: 50 }, () => generateTempPassword()));
    expect(generated.size).toBe(50);
  });
});
