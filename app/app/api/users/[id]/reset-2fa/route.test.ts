import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const userRow = vi.fn();
const updateSet = vi.fn();
const deleteWhere = vi.fn();
const authMock = vi.fn();

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => userRow() }) }),
    update: () => ({ set: (v: unknown) => { updateSet(v); return { where: async () => undefined }; } }),
    delete: () => ({ where: (...a: unknown[]) => { deleteWhere(...a); return Promise.resolve(undefined); } }),
  },
  usersTable: "users",
  userBackupCodesTable: "backup",
}));

vi.mock("@/lib/auth/require", () => ({
  requirePermission: () => authMock(),
  isAuthError: (r: unknown) => r instanceof Response,
}));

beforeAll(() => { process.env.JWT_SECRET = "test-secret-at-least-32-chars-long-xxxxx"; });

beforeEach(() => {
  userRow.mockReset(); updateSet.mockReset(); deleteWhere.mockReset(); authMock.mockReset();
  authMock.mockResolvedValue({ user: { sub: 99, role: "System Admin", isSystem: true } });
  userRow.mockReturnValue([{
    id: 5, username: "target", isSystem: false, tokenVersion: 2,
    twoFactorSecret: "S", twoFactorEnabledAt: new Date(),
  }]);
});

async function call(id = "5") {
  const { POST } = await import("./route");
  return POST(new Request("http://localhost/api/users/5/reset-2fa", { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
}

describe("POST /api/users/[id]/reset-2fa", () => {
  it("clears the 2FA secret and revokes sessions", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json())).toEqual({ ok: true });
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      twoFactorSecret: null,
      twoFactorEnabledAt: null,
      lastTotpStep: null,
      twoFactorFailedAttempts: 0,
      twoFactorLockedUntil: null,
      tokenVersion: 3,
    }));
  });

  it("deletes the user's backup codes", async () => {
    await call();
    expect(deleteWhere).toHaveBeenCalled();
  });

  it("refuses without the manage permission", async () => {
    authMock.mockResolvedValue(new Response("no", { status: 403 }));
    const res = await call();
    expect(res.status).toBe(403);
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("404s for a missing user", async () => {
    userRow.mockReturnValue([]);
    expect((await call("404")).status).toBe(404);
  });

  it("400s for a non-integer id", async () => {
    expect((await call("abc")).status).toBe(400);
  });

  it("also resets 2FA for a system account — unlike reset-password, there is no isSystem guard here", async () => {
    userRow.mockReturnValue([{ id: 5, username: "sys", isSystem: true, tokenVersion: 0 }]);
    const res = await call();
    expect(res.status).toBe(200);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ tokenVersion: 1 }));
  });
});
