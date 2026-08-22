import { describe, it, expect, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import { signSession } from "./lib/auth/jwt";
import { middleware, config } from "./middleware";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret-at-least-32-chars-long-xxxxx";
  delete process.env.UPSTASH_REDIS_REST_URL;
});

function reqFor(path: string, token?: string) {
  const url = `http://localhost${path}`;
  const headers = new Headers();
  if (token) headers.set("cookie", `adops-session=${token}`);
  return new NextRequest(new Request(url, { headers }));
}

describe("middleware auth gate", () => {
  it("redirects unauthenticated page requests to /login", async () => {
    const res = await middleware(reqFor("/clients"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("allows authenticated requests through", async () => {
    const token = await signSession({
      sub: 1, name: "Admin", username: "admin", email: "admin@advengers.com", role: "System Admin", isSystem: true, tokenVersion: 0,
    });
    const res = await middleware(reqFor("/clients", token));
    // NextResponse.next() has no redirect location.
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("middleware matcher config", () => {
  // config.matcher[0] is the same negative-lookahead pattern documented by
  // Next.js for custom matchers; it is compiled (via path-to-regexp) into a
  // regex anchored across the whole pathname, so testing it directly here
  // with explicit ^/$ anchors mirrors how Next.js actually evaluates it.
  const matcher = config.matcher[0];
  const matches = (path: string) => new RegExp(`^${matcher}$`).test(path);

  it("exempts the mid-login challenge pages from the matcher", () => {
    expect(matches("/change-password")).toBe(false);
    expect(matches("/enroll-2fa")).toBe(false);
  });

  it("still guards ordinary page routes", () => {
    expect(matches("/clients")).toBe(true);
    expect(matches("/")).toBe(true);
  });

  it("still exempts login, api, and static/internal assets", () => {
    expect(matches("/login")).toBe(false);
    expect(matches("/api/users/login")).toBe(false);
    expect(matches("/_next/static/chunk.js")).toBe(false);
    expect(matches("/_next/image")).toBe(false);
    expect(matches("/favicon.ico")).toBe(false);
  });
});
