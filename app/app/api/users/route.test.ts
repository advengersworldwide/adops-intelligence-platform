import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const selectRows = vi.fn();
const insertValues = vi.fn();
const updateSet = vi.fn();
const authMock = vi.fn();

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => selectRows(), orderBy: () => selectRows() }) }),
    insert: () => ({ values: (v: unknown) => { insertValues(v); return { returning: async () => [{ id: 7, ...(v as object) }] }; } }),
    update: () => ({ set: (v: unknown) => { updateSet(v); return { where: () => ({ returning: async () => [{ id: 5, ...(v as object) }] }) }; } }),
  },
  usersTable: { username: "username", email: "email" },
}));

vi.mock("bcryptjs", () => ({ default: { hash: async (p: string) => `hashed:${p}` } }));
vi.mock("@/lib/auth/require", () => ({
  requirePermission: () => authMock(),
  isAuthError: (r: unknown) => r instanceof Response,
}));
vi.mock("@/lib/auth/password-policy", () => ({ validatePassword: async () => ({ ok: true, errors: [] }) }));

beforeAll(() => { process.env.JWT_SECRET = "test-secret-at-least-32-chars-long-xxxxx"; });

beforeEach(() => {
  selectRows.mockReset(); insertValues.mockReset(); updateSet.mockReset(); authMock.mockReset();
  authMock.mockResolvedValue({ user: { sub: 1, role: "System Admin", isSystem: true } });
  selectRows.mockReturnValue([]);
});

async function post(body: unknown) {
  const { POST } = await import("./route");
  return POST(new Request("http://localhost/api/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
}

describe("POST /api/users", () => {
  const valid = { name: "Ahmed", username: "ahmed", email: "ahmed@x.com", role: "Viewer" };

  it("creates a user and returns a temp password when none is supplied", async () => {
    const res = await post(valid);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.tempPassword).toBeTruthy();
    expect(json.mustChangePassword).toBe(true);
  });

  it("lowercases the username before storing", async () => {
    await post({ ...valid, username: "  AhMeD  " });
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ username: "ahmed" }));
  });

  it("rejects a duplicate username", async () => {
    selectRows.mockReturnValue([{ id: 3, username: "ahmed", email: "other@x.com" }]);
    const res = await post(valid);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/username/i);
  });

  it("rejects when the email matches one row and the username matches a different row", async () => {
    selectRows.mockReturnValue([
      { id: 10, username: "someoneelse", email: "ahmed@x.com", isSystem: false, tokenVersion: 0 },
      { id: 20, username: "ahmed", email: "other@x.com", isSystem: false, tokenVersion: 0 },
    ]);
    const res = await post(valid);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/username/i);
    expect(insertValues).not.toHaveBeenCalled();
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("requires a username", async () => {
    const res = await post({ name: "A", email: "a@x.com", role: "Viewer" });
    expect(res.status).toBe(400);
  });

  it("never returns the stored password hash", async () => {
    const json = await (await post(valid)).json();
    expect(json.password).toBeUndefined();
  });

  it("refuses without the manage permission", async () => {
    authMock.mockResolvedValue(new Response("no", { status: 403 }));
    expect((await post(valid)).status).toBe(403);
  });

  it("bumps tokenVersion on an update even when no password is supplied", async () => {
    // An update is identified by email matching an existing row. A role change
    // reaches a user through exactly this path — without a fresh tokenVersion,
    // their existing session would keep the old role's authority until the JWT
    // expires (up to 24h).
    selectRows.mockReturnValue([
      { id: 5, username: "ahmed", email: "ahmed@x.com", isSystem: false, tokenVersion: 3 },
    ]);
    const res = await post(valid);
    expect(res.status).toBe(200);
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ tokenVersion: 4 }));
    expect(updateSet.mock.calls[0][0]).not.toHaveProperty("password");
  });
});
