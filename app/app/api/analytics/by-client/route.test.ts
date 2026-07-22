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
  return GET(new Request(`http://localhost/api/analytics/by-client${qs}`));
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

describe("GET /api/analytics/by-client", () => {
  it("returns 400 for an invalid query param", async () => {
    const res = await get("?costModelId=not-a-number");
    expect(res.status).toBe(400);
  });

  it("with no filters, aggregates billing_records by client, joins names, and sorts by profit desc", async () => {
    selectQueue.push([
      rec({ clientId: 1 }),
      rec({ clientId: 1 }),
      rec({ clientId: 2 }),
    ]); // billing_records select
    selectQueue.push([
      { id: 1, name: "Acme", buyingHouseName: "BH One" },
      { id: 2, name: "Globex", buyingHouseName: null },
    ]); // clients + buying_houses lookup select

    const res = await get();
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json).toHaveLength(2);

    // client 1 has 2 records -> revenue 250, cost 160, profit 90 (higher profit, sorts first)
    expect(json[0].clientId).toBe(1);
    expect(json[0].clientName).toBe("Acme");
    expect(json[0].buyingHouse).toBe("BH One");
    expect(json[0].transactionCount).toBe(2);
    expect(json[0].revenue).toBeCloseTo(250);
    expect(json[0].cost).toBeCloseTo(160);
    expect(json[0].profit).toBeCloseTo(90);
    expect(json[0].marginPct).toBeCloseTo(36);

    // client 2 has 1 record -> revenue 125, cost 80, profit 45
    expect(json[1].clientId).toBe(2);
    expect(json[1].clientName).toBe("Globex");
    expect(json[1].buyingHouse).toBeUndefined();
    expect(json[1].transactionCount).toBe(1);
    expect(json[1].revenue).toBeCloseTo(125);

    // First select() (billing_records) has no where clause when no filters are supplied.
    expect(capturedWheres[0]).toBeUndefined();
  });

  it("excludes billing_records with a null clientId from the response", async () => {
    selectQueue.push([rec({ clientId: null })]);

    const res = await get();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual([]);
  });

  it("threads clientIds into an inArray condition on billing_records.client_id (narrows the aggregation)", async () => {
    selectQueue.push([rec({ clientId: 5 })]);
    selectQueue.push([{ id: 5, name: "Client 5", buyingHouseName: null }]);

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
});
