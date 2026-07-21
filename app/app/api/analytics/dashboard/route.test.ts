import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const dialect = new PgDialect();

let selectQueue: unknown[] = [];
const capturedWheres: unknown[] = [];

function makeChain() {
  const chain: any = {
    from: () => chain,
    leftJoin: () => chain,
    where: (w: unknown) => {
      capturedWheres.push(w);
      return chain;
    },
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(selectQueue.shift() ?? []).then(resolve, reject),
  };
  return chain;
}

vi.mock("@workspace/db", async () => {
  const schema = await vi.importActual<typeof import("@workspace/db/schema")>("@workspace/db/schema");
  return { ...schema, db: { select: () => makeChain() } };
});

beforeEach(() => {
  selectQueue = [];
  capturedWheres.length = 0;
});

async function get(qs = "") {
  const { GET } = await import("./route");
  return GET(new Request(`http://localhost/api/analytics/dashboard${qs}`));
}

describe("GET /api/analytics/dashboard", () => {
  it("returns 400 for an invalid query param", async () => {
    const res = await get("?costModelId=not-a-number");
    expect(res.status).toBe(400);
  });

  it("with no filters, queries with no where clause (unchanged from before filters existed)", async () => {
    selectQueue.push([{ totalRevenue: "100", totalCost: "40", totalProfit: "60", transactionCount: 2 }]);
    selectQueue.push([{ clientCount: 3, platformCount: 2, campaignCount: 5 }]);

    const res = await get();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.totalRevenue).toBe(100);
    // Only the agg query calls .where(); with nothing to filter on it should be undefined.
    expect(capturedWheres).toEqual([undefined]);
    // No date range supplied -> deltas stay null (no prior-period query is issued).
    expect(json.revenueChange).toBeNull();
    expect(json.profitChange).toBeNull();
    expect(json.costChange).toBeNull();
  });

  it("returns non-null revenue/profit/cost deltas when a date range is supplied", async () => {
    // 1st select(): current-period aggregate
    selectQueue.push([{ totalRevenue: "200", totalCost: "120", totalProfit: "80", transactionCount: 4 }]);
    // 2nd select(): client/platform/campaign counts (unrelated to deltas)
    selectQueue.push([{ clientCount: 2, platformCount: 1, campaignCount: 3 }]);
    // 3rd select(): prior-period aggregate (same shape as the current one)
    selectQueue.push([{ totalRevenue: "100", totalCost: "60", totalProfit: "40", transactionCount: 2 }]);

    const res = await get("?dateFrom=2026-06-01&dateTo=2026-06-30");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.revenueChange).toBeCloseTo(100);
    expect(body.profitChange).not.toBeNull();
    expect(body.profitChange).toBeCloseTo(100);
    expect(body.costChange).not.toBeNull();
    expect(body.costChange).toBeCloseTo(100);
  });

  it("threads clientIds into an inArray condition on campaigns.client_id (narrows the aggregation)", async () => {
    selectQueue.push([{ totalRevenue: "10", totalCost: "4", totalProfit: "6", transactionCount: 1 }]);
    selectQueue.push([{ clientCount: 1, platformCount: 1, campaignCount: 1 }]);

    const res = await get("?clientIds=5,6");
    expect(res.status).toBe(200);

    expect(capturedWheres).toHaveLength(1);
    const whereClause = capturedWheres[0];
    expect(whereClause).toBeDefined();
    const { sql, params } = dialect.sqlToQuery(whereClause as Parameters<typeof dialect.sqlToQuery>[0]);
    expect(sql).toContain("campaigns");
    expect(sql).toContain("client_id");
    expect(sql).toContain(" in (");
    expect(params).toEqual([5, 6]);
  });
});
