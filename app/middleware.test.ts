import { describe, it, expect, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import { signSession } from "./lib/auth/jwt";
import { middleware } from "./middleware";

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
      sub: 1, name: "Admin", email: "admin@advengers.com", role: "System Admin", isSystem: true,
    });
    const res = await middleware(reqFor("/clients", token));
    // NextResponse.next() has no redirect location.
    expect(res.headers.get("location")).toBeNull();
  });
});
