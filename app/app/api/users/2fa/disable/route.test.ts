import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const userRow = vi.fn();
const updateSet = vi.fn();
const compareMock = vi.fn();

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => userRow() }) }),
    update: () => ({ set: (v: unknown) => { updateSet(v); return { where: async () => undefined }; } }),
    delete: () => ({ where: async () => undefined }),
  },
  usersTable: "users",
  userBackupCodesTable: "backup",
}));

vi.mock("bcryptjs", () => ({ default: { compare: (...a: unknown[]) => compareMock(...a) } }));

const decryptSecretMock = vi.fn((s: string) => s);
vi.mock("@/lib/auth/secret-crypto", () => ({ decryptSecret: (s: string) => decryptSecretMock(s) }));

vi.mock("@/lib/auth/totp", () => ({ verifyTotp: () => ({ valid: true, step: 1 }) }));

const permsMock = vi.fn(async () => [] as string[]);
vi.mock("@/lib/rbac/role-permissions", () => ({ getRolePermissions: () => permsMock() }));

const sessionMock = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSession: () => sessionMock() }));

beforeAll(() => { process.env.JWT_SECRET = "test-secret-at-least-32-chars-long-xxxxx"; });

const enrolled = {
  id: 1, name: "A", username: "u", email: "a@x.com", password: "h",
  role: "Viewer", isSystem: false, tokenVersion: 0,
  twoFactorSecret: "S", twoFactorEnabledAt: new Date(), lastTotpStep: null,
};

beforeEach(() => {
  userRow.mockReset(); updateSet.mockReset(); compareMock.mockReset(); sessionMock.mockReset();
  decryptSecretMock.mockReset();
  permsMock.mockResolvedValue([]);
  sessionMock.mockResolvedValue({ sub: 1 });
  compareMock.mockResolvedValue(true);
  decryptSecretMock.mockImplementation((s: string) => s);
});

async function call() {
  const { POST } = await import("./route");
  return POST(new Request("http://localhost/api/users/2fa/disable", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "pw", code: "123456" }),
  }));
}

describe("POST /api/users/2fa/disable", () => {
  it("disables 2FA and bumps tokenVersion for an ordinary user", async () => {
    userRow.mockReturnValue([enrolled]);
    expect((await call()).status).toBe(200);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      twoFactorEnabledAt: null,
      twoFactorSecret: null,
      tokenVersion: 1,
    }));
  });

  it("REFUSES for a privileged user — 2FA is mandatory for them", async () => {
    userRow.mockReturnValue([{ ...enrolled, isSystem: true }]);
    const res = await call();
    expect(res.status).toBe(403);
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("rejects a wrong password", async () => {
    userRow.mockReturnValue([enrolled]);
    compareMock.mockResolvedValue(false);
    expect((await call()).status).toBe(401);
  });

  it("returns a generic 401, not a 500, when decryptSecret throws (e.g. a rotated encryption key)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    userRow.mockReturnValue([enrolled]);
    decryptSecretMock.mockImplementation(() => {
      throw new Error("Unsupported state or unable to authenticate data");
    });
    const res = await call();
    expect(res.status).toBe(401);
    expect(updateSet).not.toHaveBeenCalled();
  });
});
