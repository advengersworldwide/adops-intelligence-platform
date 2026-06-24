import { describe, it, expect } from "vitest";
import { SESSION_COOKIE, buildCookieOptions } from "./cookies";

describe("session cookie", () => {
  it("uses a stable cookie name", () => {
    expect(SESSION_COOKIE).toBe("adops-session");
  });

  it("is httpOnly, sameSite lax, path /, 24h maxAge", () => {
    const opts = buildCookieOptions();
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.path).toBe("/");
    expect(opts.maxAge).toBe(60 * 60 * 24);
  });

  it("is secure in production and not secure in development", () => {
    expect(buildCookieOptions({}, "production").secure).toBe(true);
    expect(buildCookieOptions({}, "development").secure).toBe(false);
  });
});
