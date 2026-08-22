import { describe, it, expect } from "vitest";

describe("POST /api/users/logout", () => {
  it("returns 200 and expires the session cookie", async () => {
    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("adops-session=");
    expect(cookie).toContain("Max-Age=0");
  });

  it("also expires a leftover challenge cookie", async () => {
    // A user who abandons login mid-2FA and then signs out (e.g. from another
    // tab with a live session) would otherwise leave a live totp/password_change/
    // enroll_2fa challenge cookie behind for up to its 10-minute TTL.
    const { POST } = await import("./route");
    const res = await POST();
    const challengeCookie = res.headers.getSetCookie().find((c) => c.startsWith("adops-challenge="));
    expect(challengeCookie).toBeDefined();
    expect(challengeCookie).toContain("Max-Age=0");
  });
});
