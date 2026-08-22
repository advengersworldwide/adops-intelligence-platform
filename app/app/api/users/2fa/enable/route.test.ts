import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const userRow = vi.fn();
const updateSet = vi.fn();
const insertValues = vi.fn();

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => userRow() }) }),
    update: () => ({ set: (v: unknown) => { updateSet(v); return { where: async () => undefined }; } }),
    insert: () => ({ values: async (v: unknown) => { insertValues(v); } }),
    delete: () => ({ where: async () => undefined }),
  },
  usersTable: "users",
  userBackupCodesTable: "backup",
}));

vi.mock("@/lib/auth/secret-crypto", () => ({
  encryptSecret: (s: string) => s,
  decryptSecret: (s: string) => s,
  tryDecryptSecret: (s: string) => s,
}));
vi.mock("@/lib/rbac/role-permissions", () => ({ getRolePermissions: vi.fn(async () => []) }));

const verifyTotpMock = vi.fn();
vi.mock("@/lib/auth/totp", () => ({ verifyTotp: (...a: unknown[]) => verifyTotpMock(...a) }));

const sessionMock = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSession: () => sessionMock() }));

beforeAll(() => { process.env.JWT_SECRET = "test-secret-at-least-32-chars-long-xxxxx"; });

const pendingUser = {
  id: 1, name: "A", username: "admin", email: "a@x.com", password: "h",
  role: "Viewer", isSystem: false, tokenVersion: 0, mustChangePassword: false,
  twoFactorSecret: "SECRET", twoFactorEnabledAt: null, lastTotpStep: null,
};

beforeEach(() => {
  userRow.mockReset(); updateSet.mockReset(); insertValues.mockReset();
  verifyTotpMock.mockReset(); sessionMock.mockReset();
  // tokenVersion: 0 matches pendingUser.tokenVersion below, so resolveActor's
  // isCurrentSession check (which reads the DB via the same userRow() mock)
  // treats this session as current by default.
  sessionMock.mockResolvedValue({ sub: 1, tokenVersion: 0 });
});

async function call(code: string) {
  const { POST } = await import("./route");
  return POST(new Request("http://localhost/api/users/2fa/enable", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  }));
}

describe("POST /api/users/2fa/enable", () => {
  // These two hash ten real bcrypt codes at cost 10 (unmocked, per the "stores
  // hashed, never plaintext" assertion below) — genuine CPU-bound crypto work
  // that comfortably exceeds vitest's 5000ms default on this machine.
  it("activates 2FA and returns exactly ten backup codes", async () => {
    userRow.mockReturnValue([pendingUser]);
    verifyTotpMock.mockReturnValue({ valid: true, step: 100 });
    const res = await call("123456");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.backupCodes).toHaveLength(10);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ twoFactorEnabledAt: expect.any(Date) }));
  }, 20000);

  it("stores backup codes hashed, never in plaintext", async () => {
    userRow.mockReturnValue([pendingUser]);
    verifyTotpMock.mockReturnValue({ valid: true, step: 100 });
    const json = await (await call("123456")).json();
    const inserted = insertValues.mock.calls[0][0] as { codeHash: string }[];
    for (const code of json.backupCodes) {
      expect(inserted.some((row) => row.codeHash === code)).toBe(false);
    }
    expect(inserted[0].codeHash).toMatch(/^\$2[aby]\$/);
  }, 20000);

  it("refuses to activate when the code is wrong", async () => {
    userRow.mockReturnValue([pendingUser]);
    verifyTotpMock.mockReturnValue({ valid: false, step: null });
    expect((await call("000000")).status).toBe(401);
    expect(updateSet).not.toHaveBeenCalledWith(expect.objectContaining({ twoFactorEnabledAt: expect.anything() }));
  });

  it("rejects when no setup has been started", async () => {
    userRow.mockReturnValue([{ ...pendingUser, twoFactorSecret: null }]);
    expect((await call("123456")).status).toBe(400);
  });

  it("rejects an unauthenticated caller", async () => {
    sessionMock.mockResolvedValue(null);
    expect((await call("123456")).status).toBe(401);
  });

  it("rejects a revoked session (JWT tokenVersion stale against the DB row)", async () => {
    userRow.mockReturnValue([pendingUser]); // DB row reports tokenVersion 0
    sessionMock.mockResolvedValue({ sub: 1, tokenVersion: 99 }); // JWT claims a version that's since been bumped
    expect((await call("123456")).status).toBe(401);
    expect(updateSet).not.toHaveBeenCalled();
  });

  // Forced enrolment reaches this route with a totp_enroll challenge and no
  // session at all. Returning only { backupCodes } used to dead-end the flow
  // at the login screen — the response must now resolve and issue the next
  // step, exactly like login/2fa and me/password.
  it("issues a real session cookie after activating 2FA, alongside the backup codes", async () => {
    userRow.mockReturnValue([pendingUser]);
    verifyTotpMock.mockReturnValue({ valid: true, step: 100 });
    const res = await call("123456");
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("adops-session=");
    const json = await res.json();
    expect(json.next).toBe("session");
    expect(json.backupCodes).toHaveLength(10);
  }, 20000);

  it("routes to password_change (not session) when the user still must change their password, and still carries backup codes", async () => {
    userRow.mockReturnValue([{ ...pendingUser, mustChangePassword: true }]);
    verifyTotpMock.mockReturnValue({ valid: true, step: 100 });
    const res = await call("123456");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.next).toBe("password_change");
    expect(json.backupCodes).toHaveLength(10);
    expect(res.headers.get("set-cookie")).not.toContain("adops-session=");
  }, 20000);
});
