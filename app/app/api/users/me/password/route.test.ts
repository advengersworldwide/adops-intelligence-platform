import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { signChallenge } from "@/lib/auth/jwt";
import { CHALLENGE_COOKIE } from "@/lib/auth/cookies";

const userRow = vi.fn();
const updateSet = vi.fn();
const compareMock = vi.fn();

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => userRow() }) }),
    update: () => ({ set: (v: unknown) => { updateSet(v); return { where: async () => undefined }; } }),
  },
  usersTable: "users",
}));

vi.mock("bcryptjs", () => ({
  default: {
    compare: (...a: unknown[]) => compareMock(...a),
    hash: async (p: string) => `hashed:${p}`,
  },
}));

const validateMock = vi.fn();
vi.mock("@/lib/auth/password-policy", () => ({
  validatePassword: (...a: unknown[]) => validateMock(...a),
}));

vi.mock("@/lib/rbac/role-permissions", () => ({ getRolePermissions: vi.fn(async () => []) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => ({ success: true })) }));

const sessionMock = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSession: () => sessionMock() }));

beforeAll(() => { process.env.JWT_SECRET = "test-secret-at-least-32-chars-long-xxxxx"; });

const user = {
  id: 1, name: "A", username: "u", email: "a@x.com", password: "oldhash",
  role: "Viewer", isSystem: false, tokenVersion: 4,
  mustChangePassword: true, twoFactorEnabledAt: null,
};

// The plaintext that bcrypt.compare should treat as "the current password"
// for a given test. compareMock below resolves true only when the candidate
// it's called with matches this — a blanket `mockResolvedValue(true)` can't
// distinguish the current-password check from the reuse check (both call
// bcrypt.compare(candidate, user.password)), which would make every
// candidate look like a match, including ones that are genuinely different.
let currentPlaintext = "old";

beforeEach(() => {
  userRow.mockReset(); updateSet.mockReset(); compareMock.mockReset();
  validateMock.mockReset(); sessionMock.mockReset();
  userRow.mockReturnValue([user]);
  currentPlaintext = "old";
  compareMock.mockImplementation(async (candidate: unknown) => candidate === currentPlaintext);
  validateMock.mockResolvedValue({ ok: true, errors: [] });
  // tokenVersion: 4 matches `user.tokenVersion` below, so resolveActor's
  // isCurrentSession check (which reads the DB via the same userRow() mock)
  // treats this session as current by default.
  sessionMock.mockResolvedValue({ sub: 1, tokenVersion: 4 });
});

async function call(body: unknown, cookie?: string) {
  const { POST } = await import("./route");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers.cookie = cookie;
  return POST(new Request("http://localhost/api/users/me/password", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }));
}

describe("POST /api/users/me/password", () => {
  it("changes the password and bumps tokenVersion to kill other sessions", async () => {
    const res = await call({ currentPassword: "old", newPassword: "a new long passphrase" });
    expect(res.status).toBe(200);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      tokenVersion: 5,
      mustChangePassword: false,
      passwordChangedAt: expect.any(Date),
    }));
  });

  it("rejects a wrong current password", async () => {
    compareMock.mockResolvedValue(false);
    expect((await call({ currentPassword: "nope", newPassword: "a new long passphrase" })).status).toBe(401);
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("rejects a new password that fails policy", async () => {
    validateMock.mockResolvedValue({ ok: false, errors: ["Password must be at least 12 characters."] });
    const res = await call({ currentPassword: "old", newPassword: "short" });
    expect(res.status).toBe(400);
    expect((await res.json()).errors).toContain("Password must be at least 12 characters.");
  });

  it("rejects reusing the current password", async () => {
    // bcrypt.compare(newPassword, user.password) is checked against the
    // stored hash, not the raw submitted string, so this exercises the exact
    // case a naive string comparison would miss: the reuse check must go
    // through bcrypt even when currentPassword === newPassword verbatim.
    currentPlaintext = "same one here";
    const res = await call({ currentPassword: "same one here", newPassword: "same one here" });
    expect(res.status).toBe(400);
    expect((await res.json()).errors.join(" ")).toMatch(/different/i);
  });

  it("rejects an unauthenticated caller with no challenge", async () => {
    sessionMock.mockResolvedValue(null);
    expect((await call({ currentPassword: "a", newPassword: "a new long passphrase" })).status).toBe(401);
  });

  it("routes to enrolment when the user is privileged and unenrolled", async () => {
    userRow.mockReturnValue([{ ...user, isSystem: true }]);
    const res = await call({ currentPassword: "old", newPassword: "a new long passphrase" });
    expect(await res.json()).toMatchObject({ next: "enroll_2fa" });
  });

  it("carries totpDone:false from a password_change challenge cookie, routing to totp rather than session", async () => {
    // No live session — this is the pre-session, half-authenticated path:
    // a user mid-login on a forced password change, who has not yet done
    // TOTP this login.
    sessionMock.mockResolvedValue(null);
    userRow.mockReturnValue([{ ...user, twoFactorEnabledAt: new Date("2024-01-01T00:00:00Z") }]);
    const token = await signChallenge(1, "password_change", false);
    const res = await call(
      { currentPassword: "old", newPassword: "a new long passphrase" },
      `${CHALLENGE_COOKIE}=${token}`,
    );
    expect(await res.json()).toMatchObject({ next: "totp" });
  });

  it("does not consult a stale challenge cookie when a live session resolved the actor", async () => {
    // A signed-in user changing their password from settings may still be
    // carrying a leftover challenge cookie from an earlier, unrelated login
    // (issueChallenge never clears the session cookie, so the reverse can
    // happen too). Its totpDone:false claim must not leak into a request
    // that a real, current session authenticated.
    userRow.mockReturnValue([{ ...user, twoFactorEnabledAt: new Date("2024-01-01T00:00:00Z") }]);
    const staleToken = await signChallenge(1, "password_change", false);
    const res = await call(
      { currentPassword: "old", newPassword: "a new long passphrase" },
      `${CHALLENGE_COOKIE}=${staleToken}`,
    );
    expect(await res.json()).toMatchObject({ next: "session" });
  });
});
