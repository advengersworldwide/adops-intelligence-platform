import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

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

beforeEach(() => {
  userRow.mockReset(); updateSet.mockReset(); compareMock.mockReset();
  validateMock.mockReset(); sessionMock.mockReset();
  userRow.mockReturnValue([user]);
  compareMock.mockResolvedValue(true);
  validateMock.mockResolvedValue({ ok: true, errors: [] });
  // tokenVersion: 4 matches `user.tokenVersion` below, so resolveActor's
  // isCurrentSession check (which reads the DB via the same userRow() mock)
  // treats this session as current by default.
  sessionMock.mockResolvedValue({ sub: 1, tokenVersion: 4 });
});

async function call(body: unknown) {
  const { POST } = await import("./route");
  return POST(new Request("http://localhost/api/users/me/password", {
    method: "POST",
    headers: { "content-type": "application/json" },
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
    // bcrypt.compare returns true for BOTH the current-password check and the reuse check
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
});
