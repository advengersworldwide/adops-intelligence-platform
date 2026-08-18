import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveImpact = vi.fn();

vi.mock("@/lib/dependencies/resolve", () => ({ resolveImpact: (...a: unknown[]) => resolveImpact(...a) }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn(async () => ({ sub: 1, name: "T", email: "t@x.com", role: "System Admin", isSystem: true })) }));
vi.mock("@/lib/rbac/role-permissions", () => ({ getRolePermissions: vi.fn(async () => []) }));

beforeEach(() => resolveImpact.mockReset());

async function get(qs: string) {
  const { GET } = await import("./route");
  return GET(new Request(`http://localhost/api/dependencies?${qs}`));
}

describe("GET /api/dependencies", () => {
  it("400s when table is missing", async () => {
    expect((await get("id=1")).status).toBe(400);
  });

  it("400s when id is not a positive integer", async () => {
    expect((await get("table=clients&id=abc")).status).toBe(400);
  });

  it("400s on an unregistered table", async () => {
    const res = await get("table=pg_catalog&id=1");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/unknown table/i);
  });

  it("returns the resolved impact", async () => {
    resolveImpact.mockResolvedValueOnce({ target: { table: "clients", id: 1, label: "Acme" }, blockers: [] });
    const res = await get("table=clients&id=1");
    expect(res.status).toBe(200);
    expect((await res.json()).target.label).toBe("Acme");
  });

  it("404s when the entity does not exist", async () => {
    resolveImpact.mockRejectedValueOnce(new Error("Client not found"));
    expect((await get("table=clients&id=999")).status).toBe(404);
  });
});
