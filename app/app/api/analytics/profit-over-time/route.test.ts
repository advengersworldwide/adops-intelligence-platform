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
  return GET(new Request(`http://localhost/api/analytics/profit-over-time${qs}`));
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

describe("GET /api/analytics/profit-over-time", () => {
  it("returns 400 for an invalid query param", async () => {
    const res = await get("?costModelId=not-a-number");
    expect(res.status).toBe(400);
  });

  it("with no filters, aggregates billing_records by period and returns points sorted ascending", async () => {
    selectQueue.push([
      rec({ period: "2026-06" }),
      rec({ period: "2026-05" }),
      rec({ period: "2026-06" }),
    ]);
    const res = await get();
    expect(res.status).toBe(200);
    const json = await res.json();

    // Only one select() call (billing_records); no ids/dates -> where(undefined).
    expect(capturedWheres).toEqual([undefined]);

    expect(json).toHaveLength(2);
    expect(json[0].date).toBe("2026-05");
    expect(json[1].date).toBe("2026-06");

    // Each rec contributes receivable=125, payable=80, profit=45.
    expect(json[0].revenue).toBeCloseTo(125);
    expect(json[0].cost).toBeCloseTo(80);
    expect(json[0].profit).toBeCloseTo(45);

    expect(json[1].revenue).toBeCloseTo(250);
    expect(json[1].cost).toBeCloseTo(160);
    expect(json[1].profit).toBeCloseTo(90);
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
