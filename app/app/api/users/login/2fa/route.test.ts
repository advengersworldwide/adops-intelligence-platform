import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const userRow = vi.fn();
const backupRows = vi.fn((): { id: number; codeHash: string; usedAt: Date | null }[] => []);
const updateSet = vi.fn();

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: (t: unknown) => ({ where: () => (t === "backup" ? backupRows() : userRow()) }) }),
    update: () => ({ set: (v: unknown) => { updateSet(v); return { where: async () => undefined }; } }),
    delete: () => ({ where: async () => undefined }),
    insert: () => ({ values: async () => undefined }),
  },
  usersTable: "users",
  userBackupCodesTable: "backup",
}));

vi.mock("@/lib/rbac/role-permissions", () => ({ getRolePermissions: vi.fn(async () => []) }));

const decryptSecretMock = vi.fn((s: string) => s);
vi.mock("@/lib/auth/secret-crypto", () => ({
  decryptSecret: (s: string) => decryptSecretMock(s),
  tryDecryptSecret: (s: string) => {
    try {
      return decryptSecretMock(s);
    } catch {
      return null;
    }
  },
}));

const verifyTotpMock = vi.fn();
vi.mock("@/lib/auth/totp", () => ({ verifyTotp: (...a: unknown[]) => verifyTotpMock(...a) }));

beforeAll(() => { process.env.JWT_SECRET = "test-secret-at-least-32-chars-long-xxxxx"; });

const enrolledUser = {
  id: 1, name: "Admin", username: "admin", email: "a@x.com", password: "h",
  role: "Viewer", isSystem: false, tokenVersion: 0, mustChangePassword: false,
  twoFactorEnabledAt: new Date(), twoFactorSecret: "SECRET",
  twoFactorFailedAttempts: 0, twoFactorLockedUntil: null, lastTotpStep: null,
};

async function call(code: string, challengeToken: string) {
  const { POST } = await import("./route");
  return POST(new Request("http://localhost/api/users/login/2fa", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `adops-challenge=${challengeToken}` },
    body: JSON.stringify({ code }),
  }));
}

async function challengeFor(sub: number) {
  const { signChallenge } = await import("@/lib/auth/jwt");
  return signChallenge(sub, "totp");
}

beforeEach(() => {
  userRow.mockReset(); backupRows.mockReset(); updateSet.mockReset(); verifyTotpMock.mockReset();
  decryptSecretMock.mockReset();
  backupRows.mockReturnValue([]);
  decryptSecretMock.mockImplementation((s: string) => s);
});

describe("POST /api/users/login/2fa", () => {
  it("issues a session on a valid code", async () => {
    userRow.mockReturnValue([enrolledUser]);
    verifyTotpMock.mockReturnValue({ valid: true, step: 100 });
    const res = await call("123456", await challengeFor(1));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("adops-session=");
  });

  it("records the consumed step to block replay", async () => {
    userRow.mockReturnValue([enrolledUser]);
    verifyTotpMock.mockReturnValue({ valid: true, step: 100 });
    await call("123456", await challengeFor(1));
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ lastTotpStep: 100 }));
  });

  it("rejects an invalid code and increments the failure counter", async () => {
    userRow.mockReturnValue([enrolledUser]);
    verifyTotpMock.mockReturnValue({ valid: false, step: null });
    const res = await call("000000", await challengeFor(1));
    expect(res.status).toBe(401);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ twoFactorFailedAttempts: 1 }));
  });

  it("locks the account on the fifth failure", async () => {
    userRow.mockReturnValue([{ ...enrolledUser, twoFactorFailedAttempts: 4 }]);
    verifyTotpMock.mockReturnValue({ valid: false, step: null });
    await call("000000", await challengeFor(1));
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ twoFactorLockedUntil: expect.any(Date) }),
    );
  });

  it("returns 429 while locked out", async () => {
    userRow.mockReturnValue([{
      ...enrolledUser,
      twoFactorLockedUntil: new Date(Date.now() + 60_000),
    }]);
    expect((await call("123456", await challengeFor(1))).status).toBe(429);
  });

  it("accepts a backup code and marks it used", async () => {
    userRow.mockReturnValue([enrolledUser]);
    verifyTotpMock.mockReturnValue({ valid: false, step: null });
    const { hashBackupCode } = await import("@/lib/auth/credentials");
    backupRows.mockReturnValue([{ id: 9, codeHash: await hashBackupCode("ABCD-2345"), usedAt: null }]);
    const res = await call("ABCD-2345", await challengeFor(1));
    expect(res.status).toBe(200);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ usedAt: expect.any(Date) }));
  });

  it("returns a generic invalid response, not 500, when decryptSecret throws, and increments the failure counter", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    userRow.mockReturnValue([enrolledUser]);
    decryptSecretMock.mockImplementation(() => {
      throw new Error("Unsupported state or unable to authenticate data");
    });
    const res = await call("123456", await challengeFor(1));
    expect(res.status).toBe(401);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ twoFactorFailedAttempts: 1 }));
  });

  it("still accepts a backup code when decryptSecret throws (e.g. a rotated encryption key)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    userRow.mockReturnValue([enrolledUser]);
    decryptSecretMock.mockImplementation(() => {
      throw new Error("Unsupported state or unable to authenticate data");
    });
    const { hashBackupCode } = await import("@/lib/auth/credentials");
    backupRows.mockReturnValue([{ id: 9, codeHash: await hashBackupCode("ABCD-2345"), usedAt: null }]);
    const res = await call("ABCD-2345", await challengeFor(1));
    expect(res.status).toBe(200);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ usedAt: expect.any(Date) }));
  });

  it("rejects a request with no challenge cookie", async () => {
    const { POST } = await import("./route");
    const res = await POST(new Request("http://localhost/api/users/login/2fa", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "123456" }),
    }));
    expect(res.status).toBe(401);
  });

  it("rejects a challenge token minted for a different purpose", async () => {
    const { signChallenge } = await import("@/lib/auth/jwt");
    userRow.mockReturnValue([enrolledUser]);
    const wrong = await signChallenge(1, "password_change");
    expect((await call("123456", wrong)).status).toBe(401);
  });
});
