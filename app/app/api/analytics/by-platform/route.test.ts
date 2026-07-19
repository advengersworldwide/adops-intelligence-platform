import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const dialect = new PgDialect();

let selectQueue: unknown[] = [];
const capturedJoins: unknown[] = [];

function makeChain() {
  const chain: any = {
    from: () => chain,
    leftJoin: (_table: unknown, cond: unknown) => {
      capturedJoins.push(cond);
      return chain;
    },
    groupBy: () => chain,
    orderBy: () => chain,
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
  capturedJoins.length = 0;
});

async function get(qs = "") {
  const { GET } = await import("./route");
  return GET(new Request(`http://localhost/api/analytics/by-platform${qs}`));
}

describe("GET /api/analytics/by-platform", () => {
  it("returns 400 for an invalid query param", async () => {
    const res = await get("?costModelId=not-a-number");
    expect(res.status).toBe(400);
  });

  it("with no filters, the transactions join condition is just the campaign-id equality (unchanged from before filters existed)", async () => {
    selectQueue.push([
      { platformId: 1, platformName: "Meta", revenue: "100", cost: "40", profit: "60", transactionCount: 2 },
    ]);
    const res = await get();
    expect(res.status).toBe(200);

    // campaigns join, clients join, transactions join (last one carries the date/id filter conditions)
    expect(capturedJoins).toHaveLength(3);
    const transactionsJoinCond = capturedJoins[2];
    const { sql, params } = dialect.sqlToQuery(transactionsJoinCond as Parameters<typeof dialect.sqlToQuery>[0]);
    expect(sql).not.toContain(" in (");
    expect(params).toEqual([]);
  });

  it("threads clientIds into an inArray condition on campaigns.client_id (narrows the aggregation)", async () => {
    selectQueue.push([
      { platformId: 1, platformName: "Meta", revenue: "10", cost: "4", profit: "6", transactionCount: 1 },
    ]);
    const res = await get("?clientIds=5,6");
    expect(res.status).toBe(200);

    expect(capturedJoins).toHaveLength(3);
    const transactionsJoinCond = capturedJoins[2];
    const { sql, params } = dialect.sqlToQuery(transactionsJoinCond as Parameters<typeof dialect.sqlToQuery>[0]);
    expect(sql).toContain("campaigns");
    expect(sql).toContain("client_id");
    expect(sql).toContain(" in (");
    expect(params).toContain(5);
    expect(params).toContain(6);
  });

  it("threads buyingHouseIds into an inArray condition on clients.buying_house_id (needs the new clients join)", async () => {
    selectQueue.push([
      { platformId: 1, platformName: "Meta", revenue: "10", cost: "4", profit: "6", transactionCount: 1 },
    ]);
    const res = await get("?buyingHouseIds=9");
    expect(res.status).toBe(200);

    expect(capturedJoins).toHaveLength(3);
    const transactionsJoinCond = capturedJoins[2];
    const { sql, params } = dialect.sqlToQuery(transactionsJoinCond as Parameters<typeof dialect.sqlToQuery>[0]);
    expect(sql).toContain("clients");
    expect(sql).toContain("buying_house_id");
    expect(params).toContain(9);
  });
});
