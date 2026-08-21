import { describe, it, expect, vi, beforeEach } from "vitest";
import { Name, SQL } from "drizzle-orm";

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
import type { ImpactNode } from "./types";

const ALL = new Set([
  "clients:delete", "clients:edit", "billings:edit", "purchase-orders:edit",
  "payments:edit", "partners:delete", "partners:edit", "buying-houses:delete",
]);

type Row = Record<string, unknown>;

/**
 * `String(sql`...`)` is "[object Object]" — matching on query text silently matches
 * nothing and drops every query into the catch-all, which then hands the resolver
 * `{ n: 0 }` rows it reads as real rows with `id: undefined`. Parse the drizzle
 * chunks instead so each fixture is keyed by the exact table/column/value queried.
 */
function parseQuery(q: unknown): { kind: "select" | "count"; key: string } {
  const chunks = (q as SQL).queryChunks as unknown[];
  const names = chunks
    .filter((c): c is InstanceType<typeof Name> => c instanceof Name)
    .map(n => n.value);
  const params = chunks.filter(c => typeof c === "number" || typeof c === "string");
  // selectRows interpolates its column list as a nested SQL; countRows never does.
  const kind = chunks.some(c => c instanceof SQL) ? "select" : "count";
  return { kind, key: `${names[0]}.${names[1]}=${String(params[0])}` };
}

/** Fixtures keyed `"<table>.<column>=<value>"`; anything unlisted returns no rows. */
function withRows(fixtures: Record<string, Row[]>) {
  execute.mockImplementation(async (q: unknown) => {
    const { kind, key } = parseQuery(q);
    const rows = fixtures[key] ?? [];
    return kind === "count" ? { rows: [{ n: rows.length }] } : { rows };
  });
}

function flatten(ns: ImpactNode[]): ImpactNode[] {
  return ns.flatMap(n => [n, ...flatten(n.children)]);
}

// Braces matter: `() => execute.mockReset()` returns the mock, which vitest then
// invokes as a cleanup hook — calling db.execute() with no arguments.
beforeEach(() => { execute.mockReset(); });

describe("resolveImpact", () => {
  it("returns an empty impact for an entity with no dependents", async () => {
    withRows({ "payment_terms.id=5": [{ id: 5, name: "Unused Term" }] });

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
    withRows({
      "clients.id=1": [{ id: 1, name: "Acme" }],
      "billings.client_id=1": [{ id: 12, invoice_code: "CBILL-0012" }],
    });

    const impact = await resolveImpact("clients", 1, new Set(["clients:delete"]));
    // Exactly one blocker — the billing — and it is labelled from the real
    // snake_case column the driver returns.
    expect(impact.blockers.map(n => [n.table, n.id, n.label])).toEqual([
      ["billings", 12, "CBILL-0012"],
    ]);
    expect(impact.blockers[0]!.canDelete).toBe(false);
    expect(impact.canDeleteAll).toBe(false);
    expect(impact.missingPermissions).toEqual(["billings:edit"]);
  });

  it("expands a row reachable by two blocking paths exactly once", async () => {
    // The guaranteed shape for any client that has been billed: billings.client_id
    // reaches the billing straight from the client, and billings.client_purchase_order_id
    // (notNull, restrict) reaches the very same row again through the client's CPO.
    withRows({
      "clients.id=1": [{ id: 1, name: "Acme" }],
      "client_purchase_orders.client_id=1": [{ id: 31, code: "CPO-0031" }],
      "billings.client_id=1": [{ id: 12, invoice_code: "CBILL-0012" }],
      "billings.client_purchase_order_id=31": [{ id: 12, invoice_code: "CBILL-0012" }],
    });

    const impact = await resolveImpact("clients", 1, ALL);

    const all = flatten(impact.blockers).map(n => `${n.table}:${n.id}`);
    expect(all.filter(k => k === "billings:12")).toHaveLength(1);
    expect(all.sort()).toEqual(["billings:12", "client_purchase_orders:31"]);
    // 2 blockers + the client itself. Double-expansion reported 4.
    expect(impact.totals.deletes).toBe(3);

    // The deduplicated billing must still be deleted before the CPO it blocks.
    const order = collectDeletableNodes(impact);
    expect(order).toEqual([
      { table: "billings", id: 12 },
      { table: "client_purchase_orders", id: 31 },
    ]);
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
