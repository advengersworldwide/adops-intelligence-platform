import { describe, it, expect, vi, beforeAll } from "vitest";
import { signSession, verifySession, signChallenge, verifyChallenge, type SessionUser } from "./jwt";

const SECRET = "test-secret-at-least-32-chars-long-xxxxx";

beforeAll(() => {
  process.env.JWT_SECRET = SECRET;
});

const user: SessionUser = {
  sub: 1,
  name: "System Admin",
  username: "admin",
  email: "admin@advengers.com",
  role: "System Admin",
  isSystem: true,
  tokenVersion: 0,
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

describe("challenge tokens", () => {
  const challengeUser = {
    sub: 7,
    name: "Bilal",
    username: "bilal",
    email: "bilal@advengers.com",
    role: "System Admin",
    isSystem: true,
    tokenVersion: 3,
  };

  it("round-trips a challenge token", async () => {
    const token = await signChallenge(7, "totp");
    const claims = await verifyChallenge(token, "totp");
    expect(claims.sub).toBe(7);
    expect(claims.purpose).toBe("totp");
    expect(claims.totpDone).toBe(false);
  });

  it("carries the totpDone flag", async () => {
    const token = await signChallenge(7, "password_change", true);
    await expect(verifyChallenge(token, "password_change")).resolves.toMatchObject({ totpDone: true });
  });

  it("rejects a challenge token verified against the wrong purpose", async () => {
    const token = await signChallenge(7, "totp");
    await expect(verifyChallenge(token, "password_change")).rejects.toThrow();
  });

  it("rejects an expired challenge token", async () => {
    vi.useFakeTimers();
    try {
      const token = await signChallenge(7, "totp"); // 5 minute TTL
      vi.setSystemTime(Date.now() + 6 * 60 * 1000);
      await expect(verifyChallenge(token, "totp")).rejects.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it("CRITICAL: a challenge token cannot be used as a session", async () => {
    const token = await signChallenge(7, "totp");
    await expect(verifySession(token)).rejects.toThrow(/purpose|challenge/i);
  });

  it("a real session token is not accepted as a challenge", async () => {
    const token = await signSession(challengeUser);
    await expect(verifyChallenge(token, "totp")).rejects.toThrow();
  });

  it("round-trips tokenVersion and username on a session", async () => {
    const decoded = await verifySession(await signSession(challengeUser));
    expect(decoded.tokenVersion).toBe(3);
    expect(decoded.username).toBe("bilal");
  });
});
