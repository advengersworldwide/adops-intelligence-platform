import { describe, it, expect, vi, beforeEach } from "vitest";
import { Name } from "drizzle-orm";

const resolveImpact = vi.fn();
const txExecute = vi.fn();
const transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({ execute: txExecute }));

vi.mock("@/lib/dependencies/resolve", async () => {
  const actual = await vi.importActual<typeof import("@/lib/dependencies/resolve")>("@/lib/dependencies/resolve");
  return { ...actual, resolveImpact: (...a: unknown[]) => resolveImpact(...a) };
});
vi.mock("@workspace/db", async () => {
  // @workspace/db's index.ts throws at module-load time if DATABASE_URL is unset
  // (see app/lib/dependencies/resolve.test.ts for the same constraint). We need the
  // real dependentsOf/isBlocking (schema-derived) so resolve.ts's actual
  // collectDeletableNodes keeps working; just satisfy the load-time guard.
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
  const actual = await vi.importActual<typeof import("@workspace/db")>("@workspace/db");
  return { ...actual, db: { transaction: (cb: (tx: unknown) => Promise<unknown>) => transaction(cb) } };
});
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn(async () => ({ sub: 1, name: "T", email: "t@x.com", role: "System Admin", isSystem: true })) }));
vi.mock("@/lib/rbac/role-permissions", () => ({ getRolePermissions: vi.fn(async () => []) }));

beforeEach(() => { resolveImpact.mockReset(); txExecute.mockReset(); transaction.mockClear(); });

/** Pulls the `{table, id}` a `delete from <table> where id = <id>` sql`` call targeted. */
function deleteTargetOf(call: unknown[]): { table: string; id: unknown } {
  const chunks = (call[0] as { queryChunks: unknown[] }).queryChunks;
  const names = chunks.filter((c): c is InstanceType<typeof Name> => c instanceof Name).map((n) => n.value);
  const id = chunks.find((c) => typeof c === "number" || typeof c === "string");
  return { table: names[0], id };
}

async function post(body: unknown) {
  const { POST } = await import("./route");
  return POST(new Request("http://localhost/api/dependencies/delete", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
}

const impact = (over: Record<string, unknown> = {}) => ({
  target: { table: "clients", id: 1, label: "Acme", singular: "Client" },
  blockers: [], cascades: [], nullifies: [],
  canDeleteAll: true, blockedReason: null, missingPermissions: [],
  totals: { deletes: 1, nullifies: 0, touchesFinancial: false },
  fingerprint: "abc123",
  ...over,
});

describe("POST /api/dependencies/delete", () => {
  it("400s on a malformed body", async () => {
    expect((await post({ table: "clients" })).status).toBe(400);
  });

  it("400s on an unregistered table", async () => {
    expect((await post({ table: "pg_catalog", id: 1, fingerprint: "x" })).status).toBe(400);
  });

  it("409s when the fingerprint no longer matches", async () => {
    resolveImpact.mockResolvedValueOnce(impact({ fingerprint: "changed" }));
    const res = await post({ table: "clients", id: 1, fingerprint: "abc123" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/changed/i);
    expect(body.impact.fingerprint).toBe("changed");
  });

  it("403s when a permission is missing, naming it", async () => {
    resolveImpact.mockResolvedValueOnce(impact({ canDeleteAll: false, missingPermissions: ["billings:edit"] }));
    const res = await post({ table: "clients", id: 1, fingerprint: "abc123" });
    expect(res.status).toBe(403);
    expect((await res.json()).missingPermissions).toEqual(["billings:edit"]);
  });

  it("deletes bottom-up inside one transaction", async () => {
    resolveImpact.mockResolvedValueOnce(impact({
      blockers: [{
        table: "client_purchase_orders", id: 31, label: "CPO-0031", singular: "Client PO",
        href: null, canDelete: true, requiredPermission: "purchase-orders:edit",
        deleteEndpoint: null, truncated: false,
        children: [{
          table: "partner_purchase_orders", id: 88, label: "PPO-0088", singular: "Partner PO",
          href: null, canDelete: true, requiredPermission: "purchase-orders:edit",
          deleteEndpoint: null, truncated: false, children: [],
        }],
      }],
    }));
    const res = await post({ table: "clients", id: 1, fingerprint: "abc123" });
    expect(res.status).toBe(200);
    expect(transaction).toHaveBeenCalledOnce();
    // Every delete must run through tx.execute (inside the transaction), never db.execute
    // directly, and in deepest-first order: the leaf child, then its parent blocker,
    // then the target itself last.
    expect(txExecute.mock.calls.map(deleteTargetOf)).toEqual([
      { table: "partner_purchase_orders", id: 88 },
      { table: "client_purchase_orders", id: 31 },
      { table: "clients", id: 1 },
    ]);
  });

  it("rolls back and 500s when a delete fails", async () => {
    resolveImpact.mockResolvedValueOnce(impact());
    txExecute.mockRejectedValueOnce(new Error("deadlock detected"));
    const res = await post({ table: "clients", id: 1, fingerprint: "abc123" });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/deadlock/i);
  });
});
