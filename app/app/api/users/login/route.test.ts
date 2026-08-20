import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const selectMock = vi.fn();
const compareMock = vi.fn();

vi.mock("@workspace/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => selectMock() }) }) },
  usersTable: { username: "username", id: "id", tokenVersion: "token_version" },
}));

vi.mock("bcryptjs", () => ({ default: { compare: (...a: unknown[]) => compareMock(...a) } }));

vi.mock("@/lib/rbac/role-permissions", () => ({
  getRolePermissions: vi.fn(async () => []),
}));

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret-at-least-32-chars-long-xxxxx";
  delete process.env.UPSTASH_REDIS_REST_URL;
});

beforeEach(() => {
  selectMock.mockReset();
  compareMock.mockReset();
  compareMock.mockResolvedValue(false);
});

const baseUser = {
  id: 1,
  name: "Admin",
  username: "admin",
  email: "admin@advengers.com",
  password: "hash",
  role: "Viewer",
  isSystem: false,
  tokenVersion: 0,
  mustChangePassword: false,
  twoFactorEnabledAt: null,
};

async function call(body: unknown) {
  const { POST } = await import("./route");
  return POST(new Request("http://localhost/api/users/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

describe("POST /api/users/login", () => {
  it("issues a session when nothing is pending", async () => {
    selectMock.mockResolvedValueOnce([baseUser]);
    compareMock.mockResolvedValue(true);
    const res = await call({ username: "admin", password: "right" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ next: "session" });
    const setCookies = res.headers.getSetCookie();
    const sessionCookie = setCookies.find((c) => c.startsWith("adops-session="));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain("HttpOnly");
  });

  it("returns a totp challenge WITHOUT a session cookie for an enrolled user", async () => {
    selectMock.mockResolvedValueOnce([{ ...baseUser, twoFactorEnabledAt: new Date() }]);
    compareMock.mockResolvedValue(true);
    const res = await call({ username: "admin", password: "right" });
    expect(await res.json()).toMatchObject({ next: "totp" });
    const setCookies = res.headers.getSetCookie();
    expect(setCookies.some((c) => c.startsWith("adops-challenge="))).toBe(true);
    expect(setCookies.some((c) => c.startsWith("adops-session=ey"))).toBe(false); // no real session issued
  });

  it("returns a password_change challenge for a temp password", async () => {
    selectMock.mockResolvedValueOnce([{ ...baseUser, mustChangePassword: true }]);
    compareMock.mockResolvedValue(true);
    expect(await (await call({ username: "admin", password: "temp" })).json())
      .toMatchObject({ next: "password_change" });
  });

  it("forces enrolment for a privileged user without 2FA", async () => {
    selectMock.mockResolvedValueOnce([{ ...baseUser, isSystem: true }]);
    compareMock.mockResolvedValue(true);
    expect(await (await call({ username: "admin", password: "right" })).json())
      .toMatchObject({ next: "enroll_2fa" });
  });

  it("lowercases the submitted username", async () => {
    selectMock.mockResolvedValueOnce([baseUser]);
    compareMock.mockResolvedValue(true);
    await call({ username: "  ADMIN  ", password: "right" });
    expect(compareMock).toHaveBeenCalled();
  });

  it("returns 401 on a wrong password", async () => {
    selectMock.mockResolvedValueOnce([baseUser]);
    expect((await call({ username: "admin", password: "wrong" })).status).toBe(401);
  });

  it("still runs a bcrypt compare when no user matches (timing)", async () => {
    selectMock.mockResolvedValueOnce([]);
    const res = await call({ username: "nobody", password: "whatever" });
    expect(res.status).toBe(401);
    expect(compareMock).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when fields are missing", async () => {
    expect((await call({ username: "" })).status).toBe(400);
  });
});
