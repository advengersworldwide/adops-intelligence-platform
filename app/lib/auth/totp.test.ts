import { describe, it, expect } from "vitest";
import { generateSecret, buildOtpauthUri, verifyTotp, generateCode, currentStep, TOTP_PERIOD } from "./totp";

const FIXED_NOW = 1_700_000_000_000; // deterministic clock

describe("totp", () => {
  it("generates a base32 secret", () => {
    expect(generateSecret()).toMatch(/^[A-Z2-7]+$/);
  });

  it("builds an otpauth URI carrying issuer and label", () => {
    const uri = buildOtpauthUri(generateSecret(), "bilal");
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain("AdOps");
    expect(uri).toContain("bilal");
  });

  it("accepts a code generated for the current step", () => {
    const secret = generateSecret();
    const code = generateCode(secret, FIXED_NOW);
    const result = verifyTotp(secret, code, null, FIXED_NOW);
    expect(result.valid).toBe(true);
    expect(result.step).toBe(currentStep(FIXED_NOW));
  });

  it("accepts a code from one step earlier (clock drift)", () => {
    const secret = generateSecret();
    const code = generateCode(secret, FIXED_NOW - TOTP_PERIOD * 1000);
    expect(verifyTotp(secret, code, null, FIXED_NOW).valid).toBe(true);
  });

  it("rejects a code from far outside the window", () => {
    const secret = generateSecret();
    const code = generateCode(secret, FIXED_NOW - 10 * TOTP_PERIOD * 1000);
    expect(verifyTotp(secret, code, null, FIXED_NOW).valid).toBe(false);
  });

  it("rejects a wrong code", () => {
    expect(verifyTotp(generateSecret(), "000000", null, FIXED_NOW).valid).toBe(false);
  });

  it("rejects replay of an already-consumed step", () => {
    const secret = generateSecret();
    const code = generateCode(secret, FIXED_NOW);
    const first = verifyTotp(secret, code, null, FIXED_NOW);
    expect(first.valid).toBe(true);
    // Same code, same 30s window, but the step is now recorded as consumed.
    expect(verifyTotp(secret, code, first.step, FIXED_NOW).valid).toBe(false);
  });

  it("rejects a code for a step at or below the recorded step", () => {
    const secret = generateSecret();
    const code = generateCode(secret, FIXED_NOW);
    expect(verifyTotp(secret, code, currentStep(FIXED_NOW) + 5, FIXED_NOW).valid).toBe(false);
  });
});
