import { describe, it, expect, vi, beforeEach } from "vitest";

const execute = vi.fn();

vi.mock("@workspace/db", async () => {
  // @workspace/db's index.ts throws at module-load time if DATABASE_URL is unset
  // (see app/lib/import/descriptors/partner-bills.test.ts for the same constraint).
  // We need the real dependentsOf/isBlocking/fkEdges (schema-derived), so we can't
  // hand-mock the whole module like other tests do — just satisfy the load-time
  // guard with a placeholder. `db.execute` is overridden below, so no real
  // connection is ever attempted.
  process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
  const actual = await vi.importActual<typeof import("@workspace/db")>("@workspace/db");
  return { ...actual, db: { execute: (...a: unknown[]) => execute(...a) } };
});

import { resolveImpact, collectDeletableNodes } from "./resolve";
import { fingerprintOf } from "./fingerprint";

const ALL = new Set([
  "clients:delete", "clients:edit", "billings:edit", "purchase-orders:edit",
  "payments:edit", "partners:delete", "partners:edit", "buying-houses:delete",
]);

/** Queue results in the order resolveImpact will consume them. */
function queue(...results: Record<string, unknown>[][]) {
  for (const rows of results) execute.mockResolvedValueOnce({ rows });
}

beforeEach(() => execute.mockReset());

describe("resolveImpact", () => {
  it("returns an empty impact for an entity with no dependents", async () => {
    queue([{ id: 5, name: "Unused Term" }]); // target row
    // every dependent count query returns 0
    execute.mockResolvedValue({ rows: [{ n: 0 }] });

    const impact = await resolveImpact("payment_terms", 5, ALL);
    expect(impact.blockers).toEqual([]);
    expect(impact.cascades).toEqual([]);
    expect(impact.nullifies).toEqual([]);
    // totals.deletes is the true blast radius and includes the target row
    // itself, so "no dependents" still means exactly 1 (the row being
    // deleted) — not 0.
    expect(impact.totals.deletes).toBe(1);
    expect(impact.canDeleteAll).toBe(true);
  });

  it("marks a node undeletable when the permission is missing", async () => {
    queue([{ id: 1, name: "Acme" }]);
    execute.mockImplementation(async (q: unknown) => {
      const text = String(q);
      if (text.includes("billings")) {
        return text.includes("count") ? { rows: [{ n: 1 }] } : { rows: [{ id: 12, invoice_code: "CBILL-0012" }] };
      }
      return { rows: [{ n: 0 }] };
    });

    const impact = await resolveImpact("clients", 1, new Set(["clients:delete"]));
    expect(impact.canDeleteAll).toBe(false);
    expect(impact.missingPermissions).toContain("billings:edit");
  });

  it("produces a fingerprint that is order-independent", () => {
    const a = fingerprintOf([{ table: "billings", id: 2 }, { table: "clients", id: 1 }]);
    const b = fingerprintOf([{ table: "clients", id: 1 }, { table: "billings", id: 2 }]);
    expect(a).toBe(b);
  });

  it("produces a different fingerprint when the node set changes", () => {
    const a = fingerprintOf([{ table: "billings", id: 2 }]);
    const b = fingerprintOf([{ table: "billings", id: 2 }, { table: "billings", id: 3 }]);
    expect(a).not.toBe(b);
  });

  it("rejects an unregistered table", async () => {
    await expect(resolveImpact("nope", 1, ALL)).rejects.toThrow(/descriptor/i);
  });

  it("collectDeletableNodes flattens blockers depth-first, deepest first", () => {
    const impact = {
      blockers: [{
        table: "client_purchase_orders", id: 31, children: [
          { table: "partner_purchase_orders", id: 88, children: [] },
        ],
      }],
      cascades: [],
    } as unknown as Parameters<typeof collectDeletableNodes>[0];

    expect(collectDeletableNodes(impact)).toEqual([
      { table: "partner_purchase_orders", id: 88 },
      { table: "client_purchase_orders", id: 31 },
    ]);
  });
});
