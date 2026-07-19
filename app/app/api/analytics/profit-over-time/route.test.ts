import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const dialect = new PgDialect();

let selectQueue: unknown[] = [];
const capturedWheres: unknown[] = [];

function makeChain() {
  const chain: any = {
    from: () => chain,
    leftJoin: () => chain,
    groupBy: () => chain,
    orderBy: () => chain,
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

describe("GET /api/analytics/profit-over-time", () => {
  it("returns 400 for an invalid query param", async () => {
    const res = await get("?costModelId=not-a-number");
    expect(res.status).toBe(400);
  });

  it("with no filters, queries with no where clause (unchanged from before filters existed)", async () => {
    selectQueue.push([{ date: "2026-01-01", revenue: "100", cost: "40", profit: "60" }]);
    const res = await get();
    expect(res.status).toBe(200);
    expect(capturedWheres).toEqual([undefined]);
  });

  it("threads clientIds into an inArray condition on campaigns.client_id (narrows the aggregation)", async () => {
    selectQueue.push([{ date: "2026-01-01", revenue: "10", cost: "4", profit: "6" }]);
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
