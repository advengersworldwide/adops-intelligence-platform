import { describe, it, expect, beforeAll } from "vitest";
import { signSession, verifySession, type SessionUser } from "./jwt";

const SECRET = "test-secret-at-least-32-chars-long-xxxxx";

beforeAll(() => {
  process.env.JWT_SECRET = SECRET;
});

const user: SessionUser = {
  sub: 1,
  name: "System Admin",
  email: "admin@advengers.com",
  role: "System Admin",
  isSystem: true,
};

describe("jwt session", () => {
  it("signs and verifies a session round-trip", async () => {
    const token = await signSession(user);
    const decoded = await verifySession(token);
    expect(decoded).toMatchObject(user);
  });

  it("rejects a tampered token", async () => {
    const token = await signSession(user);
    await expect(verifySession(token + "x")).rejects.toThrow();
  });

  it("rejects with a wrong-secret token", async () => {
    const token = await signSession(user);
    process.env.JWT_SECRET = "a-different-secret-also-32-chars-minimum";
    await expect(verifySession(token)).rejects.toThrow();
    process.env.JWT_SECRET = SECRET;
  });
});
