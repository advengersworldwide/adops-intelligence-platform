import { describe, it, expect, vi, beforeAll } from "vitest";

const selectMock = vi.fn();

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => selectMock() }) }),
  },
  usersTable: { email: "email" },
}));

vi.mock("bcryptjs", () => ({
  default: { compare: vi.fn(async (a: string, b: string) => a === "right" && b === "hash") },
}));

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret-at-least-32-chars-long-xxxxx";
  delete process.env.UPSTASH_REDIS_REST_URL;
});

async function call(body: unknown) {
  const { POST } = await import("./route");
  const req = new Request("http://localhost/api/users/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req);
}

describe("POST /api/users/login", () => {
  it("returns 200 + sets session cookie on valid credentials", async () => {
    selectMock.mockResolvedValueOnce([
      { id: 1, name: "Admin", email: "admin@advengers.com", password: "hash", role: "System Admin", isSystem: true },
    ]);
    const res = await call({ email: "admin@advengers.com", password: "right" });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("adops-session=");
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("returns 401 on wrong password", async () => {
    selectMock.mockResolvedValueOnce([
      { id: 1, name: "Admin", email: "admin@advengers.com", password: "hash", role: "System Admin", isSystem: true },
    ]);
    const res = await call({ email: "admin@advengers.com", password: "wrong" });
    expect(res.status).toBe(401);
  });

  it("returns 400 when fields are missing", async () => {
    const res = await call({ email: "" });
    expect(res.status).toBe(400);
  });
});
