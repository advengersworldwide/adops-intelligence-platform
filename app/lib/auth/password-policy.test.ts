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

  it("accepts a 72-character ASCII password", async () => {
    const result = await validatePassword("a".repeat(MAX_PASSWORD_LENGTH));
    expect(result.ok).toBe(true);
  });

  it("rejects a 72-character multi-byte password (exceeds 72-byte limit)", async () => {
    // "é" is 2 bytes in UTF-8, so 72 characters = 144 bytes
    const result = await validatePassword("é".repeat(72));
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
    const mockFetch = vi.fn(async () => new Response("0000000000000000000000000000000000A:1\nF19974A00FB7A3CC5C86EE6C419ABB63C14:24230577", { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);
    const result = await validatePassword("password123!!");
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("breach");
    // Verify k-anonymity: only the 5-char prefix is sent, not the full hash or password
    expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining("/2EA80"), expect.anything());
    const calledUrl = mockFetch.mock.calls[0]?.[0] as string;
    expect(calledUrl).not.toContain("F19974A00FB7A3CC5C86EE6C419ABB63C14"); // full hash not sent
    expect(calledUrl).not.toContain("password123!!"); // password not sent
  });
});

describe("isBreached", () => {
  it("fails open when the breach API is unreachable", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    await expect(isBreached("correct horse battery staple")).resolves.toBe(false);
  });

  it("fails open on a non-200 response", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    await expect(isBreached("correct horse battery staple")).resolves.toBe(false);
  });
});
