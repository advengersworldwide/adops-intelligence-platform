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
  return GET(new Request(`http://localhost/api/analytics/by-platform${qs}`));
}

// A billing_records row that, per computeRow, yields receivable=125, payable=80, profit=45
// (100 pins, no fraud, payoutRate 1, marginPct 20, forex 1, all taxes/discounts 0).
function rec(overrides: Record<string, unknown> = {}) {
  return {
    clientId: 1,
    platformId: 1,
    buyingHouseId: 1,
    period: "2026-06",
    appsflyerPins: 100,
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

describe("GET /api/analytics/by-platform", () => {
  it("returns 400 for an invalid query param", async () => {
    const res = await get("?costModelId=not-a-number");
    expect(res.status).toBe(400);
  });

  it("with no filters, aggregates billing_records by platform, joins names, and sorts by profit desc", async () => {
    selectQueue.push([
      rec({ platformId: 1 }),
      rec({ platformId: 1 }),
      rec({ platformId: 2 }),
    ]); // billing_records select
    selectQueue.push([
      { id: 1, name: "Meta" },
      { id: 2, name: "TikTok" },
    ]); // partners lookup select

    const res = await get();
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json).toHaveLength(2);

    // platform 1 has 2 records -> revenue 250, cost 160, profit 90 (higher profit, sorts first)
    expect(json[0].platformId).toBe(1);
    expect(json[0].platformName).toBe("Meta");
    expect(json[0].transactionCount).toBe(2);
    expect(json[0].revenue).toBeCloseTo(250);
    expect(json[0].cost).toBeCloseTo(160);
    expect(json[0].profit).toBeCloseTo(90);
    expect(json[0].marginPct).toBeCloseTo(36);

    // platform 2 has 1 record -> revenue 125, cost 80, profit 45
    expect(json[1].platformId).toBe(2);
    expect(json[1].platformName).toBe("TikTok");
    expect(json[1].transactionCount).toBe(1);
    expect(json[1].revenue).toBeCloseTo(125);

    // First select() (billing_records) has no where clause when no filters are supplied.
    expect(capturedWheres[0]).toBeUndefined();
  });

  it("threads clientIds into an inArray condition on billing_records.client_id (narrows the aggregation)", async () => {
    selectQueue.push([rec({ platformId: 1, clientId: 5 })]);
    selectQueue.push([{ id: 1, name: "Meta" }]);

    const res = await get("?clientIds=5,6");
    expect(res.status).toBe(200);

    const whereClause = capturedWheres[0];
    expect(whereClause).toBeDefined();
    const { sql, params } = dialect.sqlToQuery(whereClause as Parameters<typeof dialect.sqlToQuery>[0]);
    expect(sql).toContain("billing_records");
    expect(sql).toContain("client_id");
    expect(sql).toContain(" in (");
    expect(params).toEqual([5, 6]);
  });

  it("threads buyingHouseIds into an inArray condition on billing_records.buying_house_id (no join needed)", async () => {
    selectQueue.push([rec({ platformId: 1, buyingHouseId: 9 })]);
    selectQueue.push([{ id: 1, name: "Meta" }]);

    const res = await get("?buyingHouseIds=9");
    expect(res.status).toBe(200);

    const whereClause = capturedWheres[0];
    expect(whereClause).toBeDefined();
    const { sql, params } = dialect.sqlToQuery(whereClause as Parameters<typeof dialect.sqlToQuery>[0]);
    expect(sql).toContain("billing_records");
    expect(sql).toContain("buying_house_id");
    expect(params).toContain(9);
  });
});
