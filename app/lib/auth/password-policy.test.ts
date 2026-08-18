import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { validatePassword, isBreached, MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from "./password-policy";

const okFetch = (body: string) =>
  vi.fn(async () => new Response(body, { status: 200 }));

beforeEach(() => {
  vi.stubGlobal("fetch", okFetch(""));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("validatePassword", () => {
  it("rejects a password shorter than the minimum", async () => {
    const result = await validatePassword("a".repeat(MIN_PASSWORD_LENGTH - 1));
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("12");
  });

  it("accepts a password exactly at the minimum", async () => {
    const result = await validatePassword("a".repeat(MIN_PASSWORD_LENGTH));
    expect(result.ok).toBe(true);
  });

  it("rejects a password longer than the maximum", async () => {
    const result = await validatePassword("a".repeat(MAX_PASSWORD_LENGTH + 1));
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("72");
  });

  it("accepts a long passphrase with no symbols or uppercase", async () => {
    const result = await validatePassword("correct horse battery staple");
    expect(result.ok).toBe(true);
  });

  it("rejects a breached password", async () => {
    // SHA-1("password123!!") = 2EA80 F19974A00FB7A3CC5C86EE6C419ABB63C14
    // The range API returns only the suffix (everything after the 5-char prefix),
    // so the mocked body must carry the suffix of the password under test.
    vi.stubGlobal("fetch", okFetch("0000000000000000000000000000000000A:1\nF19974A00FB7A3CC5C86EE6C419ABB63C14:24230577"));
    const result = await validatePassword("password123!!");
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("breach");
  });
});

describe("isBreached", () => {
  it("fails open when the breach API is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    await expect(isBreached("correct horse battery staple")).resolves.toBe(false);
  });

  it("fails open on a non-200 response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    await expect(isBreached("correct horse battery staple")).resolves.toBe(false);
  });
});
