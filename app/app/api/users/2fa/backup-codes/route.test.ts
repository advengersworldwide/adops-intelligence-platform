import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const userRow = vi.fn();
const deleteWhere = vi.fn();
const insertValues = vi.fn();

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => userRow() }) }),
    delete: () => ({ where: (...a: unknown[]) => { deleteWhere(...a); return Promise.resolve(undefined); } }),
    insert: () => ({ values: async (v: unknown) => { insertValues(v); } }),
  },
  usersTable: "users",
  userBackupCodesTable: "backup",
}));

// backup-codes is reachable only by an already-fully-authenticated,
// already-enrolled user, so it gates on requireAuth (tokenVersion-checked)
// rather than raw getSession — mocked the same way as other requireAuth-
// guarded routes in this repo (see app/app/api/me/dashboard-layout/route.test.ts).
const requireAuthMock = vi.fn();
vi.mock("@/lib/auth/require", () => ({
  requireAuth: () => requireAuthMock(),
  isAuthError: (r: unknown) => r instanceof Response,
}));

beforeAll(() => { process.env.JWT_SECRET = "test-secret-at-least-32-chars-long-xxxxx"; });

const enrolled = {
  id: 1, name: "A", username: "u", email: "a@x.com", password: "h",
  role: "Viewer", isSystem: false, tokenVersion: 0,
  twoFactorSecret: "S", twoFactorEnabledAt: new Date(), lastTotpStep: null,
};

beforeEach(() => {
  userRow.mockReset(); deleteWhere.mockReset(); insertValues.mockReset(); requireAuthMock.mockReset();
  requireAuthMock.mockResolvedValue({ user: { sub: 1 } });
});

async function call() {
  const { POST } = await import("./route");
  return POST();
}

describe("POST /api/users/2fa/backup-codes", () => {
  // Hashes ten real bcrypt codes at cost 12 (unmocked, per the "codeHash
  // matches a real bcrypt hash" assertion below) — genuine CPU-bound crypto
  // work that comfortably exceeds vitest's 5000ms default on this machine.
  it("regenerates: deletes prior codes, inserts ten new hashed ones, returns them once", async () => {
    userRow.mockReturnValue([enrolled]);
    const res = await call();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.backupCodes).toHaveLength(10);
    expect(deleteWhere).toHaveBeenCalled();
    const inserted = insertValues.mock.calls[0][0] as { codeHash: string }[];
    expect(inserted).toHaveLength(10);
    for (const code of json.backupCodes) {
      expect(inserted.some((row) => row.codeHash === code)).toBe(false);
    }
    expect(inserted[0].codeHash).toMatch(/^\$2[aby]\$/);
  }, 20000);

  it("rejects when the user is not enrolled in 2FA", async () => {
    userRow.mockReturnValue([{ ...enrolled, twoFactorEnabledAt: null }]);
    const res = await call();
    expect(res.status).toBe(400);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("rejects a revoked session — requireAuth's tokenVersion check runs before any of this route's own logic", async () => {
    requireAuthMock.mockResolvedValue(new Response(JSON.stringify({ error: "Authentication required" }), { status: 401 }));
    const res = await call();
    expect(res.status).toBe(401);
    expect(userRow).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
  });
});
