import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveImpact = vi.fn();
const getSession = vi.fn();
const getRolePermissions = vi.fn();

vi.mock("@/lib/dependencies/resolve", async () => {
  // @workspace/db's index.ts throws at module-load time if DATABASE_URL is unset.
  // We need the real NotFoundError class, so we can't hand-mock the whole module.
  // Just satisfy the load-time guard with a placeholder.
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
  const actual = await vi.importActual<typeof import("@/lib/dependencies/resolve")>("@/lib/dependencies/resolve");
  return { ...actual, resolveImpact: (...args: unknown[]) => resolveImpact(...args) };
});
vi.mock("@/lib/auth/session", () => ({ getSession: (...args: unknown[]) => getSession(...args) }));
vi.mock("@/lib/rbac/role-permissions", () => ({ getRolePermissions: (...args: unknown[]) => getRolePermissions(...args) }));

beforeEach(() => {
  resolveImpact.mockReset();
  getSession.mockReset();
  getRolePermissions.mockReset();
  getSession.mockResolvedValue({ sub: 1, name: "T", email: "t@x.com", role: "System Admin", isSystem: true });
  getRolePermissions.mockResolvedValue([]);
});

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
    const { NotFoundError } = await import("@/lib/dependencies/resolve");
    resolveImpact.mockRejectedValueOnce(new NotFoundError("Client not found"));
    expect((await get("table=clients&id=999")).status).toBe(404);
  });

  it("500s on an unrelated error, even one whose message says 'not found'", async () => {
    resolveImpact.mockRejectedValueOnce(new Error("relation \"clients\" not found"));
    expect((await get("table=clients&id=1")).status).toBe(500);
  });

  it("401s when session is null", async () => {
    getSession.mockResolvedValueOnce(null as unknown);
    expect((await get("table=clients&id=1")).status).toBe(401);
  });

  it("403s when user lacks delete permission", async () => {
    getSession.mockResolvedValueOnce({ sub: 2, name: "V", email: "v@x.com", role: "Viewer", isSystem: false });
    // Return realistic permission strings: these don't include clients:delete, so check should fail
    getRolePermissions.mockResolvedValueOnce(["clients:view", "billings:view"]);
    expect((await get("table=clients&id=1")).status).toBe(403);
  });
});
