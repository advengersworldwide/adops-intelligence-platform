import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const userRow = vi.fn();
const updateSet = vi.fn();
const authMock = vi.fn();

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => userRow() }) }),
    update: () => ({ set: (v: unknown) => { updateSet(v); return { where: async () => undefined }; } }),
  },
  usersTable: "users",
}));

vi.mock("bcryptjs", () => ({ default: { hash: async (p: string) => `hashed:${p}` } }));

vi.mock("@/lib/auth/require", () => ({
  requirePermission: () => authMock(),
  isAuthError: (r: unknown) => r instanceof Response,
}));

beforeAll(() => { process.env.JWT_SECRET = "test-secret-at-least-32-chars-long-xxxxx"; });

beforeEach(() => {
  userRow.mockReset(); updateSet.mockReset(); authMock.mockReset();
  authMock.mockResolvedValue({ user: { sub: 99, role: "System Admin", isSystem: true } });
  userRow.mockReturnValue([{ id: 5, username: "target", isSystem: false, tokenVersion: 2 }]);
});

async function call(id = "5") {
  const { POST } = await import("./route");
  return POST(new Request("http://localhost/api/users/5/reset-password", { method: "POST" }), {
    params: Promise.resolve({ id }),
  });
}

describe("POST /api/users/[id]/reset-password", () => {
  it("returns a temp password meeting the length policy", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).tempPassword.length).toBeGreaterThanOrEqual(12);
  });

  it("forces a change and revokes sessions", async () => {
    await call();
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      mustChangePassword: true,
      tokenVersion: 3,
    }));
  });

  it("never stores the temp password in plaintext", async () => {
    const json = await (await call()).json();
    const written = updateSet.mock.calls[0][0] as { password: string };
    expect(written.password).not.toBe(json.tempPassword);
    expect(written.password).toContain("hashed:");
  });

  it("refuses without the manage permission", async () => {
    authMock.mockResolvedValue(new Response("no", { status: 403 }));
    expect((await call()).status).toBe(403);
  });

  it("refuses to reset a system account", async () => {
    userRow.mockReturnValue([{ id: 5, username: "sys", isSystem: true, tokenVersion: 0 }]);
    expect((await call()).status).toBe(400);
  });

  it("404s for a missing user", async () => {
    userRow.mockReturnValue([]);
    expect((await call("404")).status).toBe(404);
  });
});
