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
});
