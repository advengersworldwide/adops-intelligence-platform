import { describe, it, expect, vi, beforeEach } from "vitest";

// RBAC: routes now enforce permissions; bypass the guard in unit tests.
vi.mock("@/lib/auth/require", () => ({
  requirePermission: async () => ({ user: { sub: 1, name: "Test", email: "test@x.com", role: "System Admin", isSystem: true } }),
  requireAuth: async () => ({ user: { sub: 1, name: "Test", email: "test@x.com", role: "System Admin", isSystem: true } }),
  requireAdmin: async () => ({ user: { sub: 1, name: "Test", email: "test@x.com", role: "System Admin", isSystem: true } }),
  isAuthError: (r: unknown) => r instanceof Response,
}));

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

// A billing_records row that, per computeRow, yields receivable=125, payable=80, profit=45
// (100 pins, no fraud, payoutRate 1, marginPct 20, forex 1, all taxes/discounts 0).
function rec(overrides: Record<string, unknown> = {}) {
  return {
    clientId: 1,
    platformId: 1,
    buyingHouseId: 1,
    period: "2026-06",
    pins: 100,
    fraudPins: 0,
    payoutRate: "1",
    marginPct: "20",
    forexSellingRate: "1",
    forexBuyingRate: "1",
    salesTaxPct: "0",
    remittanceTaxPct: "0",
    withholdingTaxPct: "0",
    bulkDiscountPct: "0",
    platformBulkDiscountPct: "0",
    ...overrides,
  };
}

describe("GET /api/analytics/dashboard", () => {
  it("returns 400 for an invalid query param", async () => {
    const res = await get("?costModelId=not-a-number");
    expect(res.status).toBe(400);
  });

  it("with no filters, aggregates billing_records with no where clause and derives totals/counts from the rows", async () => {
    selectQueue.push([
      rec({ clientId: 1, platformId: 1 }),
      rec({ clientId: 2, platformId: 1 }),
      rec({ clientId: null, platformId: 2 }),
    ]);

    const res = await get();
    expect(res.status).toBe(200);
    const json = await res.json();

    // Each record contributes receivable=125, payable=80, profit=45.
    expect(json.totalRevenue).toBeCloseTo(375);
    expect(json.totalCost).toBeCloseTo(240);
    expect(json.totalProfit).toBeCloseTo(135);
    expect(json.marginPct).toBeCloseTo(36); // 135 / 375 * 100

    expect(json.clientCount).toBe(2); // distinct non-null client ids {1,2}
    expect(json.platformCount).toBe(2); // distinct platform ids {1,2}
    expect(json.transactionCount).toBe(3); // row count
    expect(json.campaignCount).toBe(0); // kept for shape only

    // Only one select() call (the current-window fetch); no ids/dates -> where(undefined).
    expect(capturedWheres).toEqual([undefined]);

    // No date range supplied -> deltas stay null (no prior-period query is issued).
    expect(json.revenueChange).toBeNull();
    expect(json.profitChange).toBeNull();
    expect(json.costChange).toBeNull();
  });

  it("returns non-null revenue/profit/cost deltas when a date range is supplied", async () => {
    // 1st select(): current-period rows (2 records -> revenue 250, cost 160, profit 90)
    selectQueue.push([rec(), rec()]);
    // 2nd select(): prior-period rows (1 record -> revenue 125, cost 80, profit 45)
    selectQueue.push([rec()]);

    const res = await get("?dateFrom=2026-06-01&dateTo=2026-06-30");
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.totalRevenue).toBeCloseTo(250);
    expect(body.totalCost).toBeCloseTo(160);
    expect(body.totalProfit).toBeCloseTo(90);

    expect(body.revenueChange).not.toBeNull();
    expect(body.revenueChange).toBeCloseTo(100); // (250-125)/125*100
    expect(body.profitChange).not.toBeNull();
    expect(body.profitChange).toBeCloseTo(100); // (90-45)/45*100
    expect(body.costChange).not.toBeNull();
    expect(body.costChange).toBeCloseTo(100); // (160-80)/80*100
  });

  it("threads clientIds into an inArray condition on billing_records.client_id (narrows the aggregation)", async () => {
    selectQueue.push([rec({ clientId: 5 })]);

    const res = await get("?clientIds=5,6");
    expect(res.status).toBe(200);

    expect(capturedWheres).toHaveLength(1);
    const whereClause = capturedWheres[0];
    expect(whereClause).toBeDefined();
    const { sql, params } = dialect.sqlToQuery(whereClause as Parameters<typeof dialect.sqlToQuery>[0]);
    expect(sql).toContain("billing_records");
    expect(sql).toContain("client_id");
    expect(sql).toContain(" in (");
    expect(params).toEqual([5, 6]);
  });
});
