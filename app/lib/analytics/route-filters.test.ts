import { describe, it, expect } from "vitest";
import { and } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildTransactionConditions } from "./route-filters";

const dialect = new PgDialect();

function render(conditions: ReturnType<typeof buildTransactionConditions>) {
  const combined = conditions.length > 0 ? and(...conditions) : undefined;
  if (!combined) return { sql: "", params: [] as unknown[] };
  return dialect.sqlToQuery(combined);
}

describe("buildTransactionConditions", () => {
  it("returns no conditions when nothing is supplied", () => {
    expect(buildTransactionConditions({})).toEqual([]);
  });

  it("keeps only the date-range conditions when no id filters are supplied (no-filter behavior unchanged)", () => {
    const conditions = buildTransactionConditions({ dateFrom: "2026-01-01", dateTo: "2026-01-31" });
    expect(conditions).toHaveLength(2);
    const { sql, params } = render(conditions);
    expect(sql).toContain("transactions");
    expect(sql).not.toContain(" in (");
    expect(params).toEqual(["2026-01-01", "2026-01-31"]);
  });

  it("ignores empty id-list filters (does not add inArray for [])", () => {
    const conditions = buildTransactionConditions({ clientIds: [], partnerIds: [], buyingHouseIds: [] });
    expect(conditions).toEqual([]);
  });

  it("adds an inArray condition on campaigns.client_id when clientIds is non-empty", () => {
    const conditions = buildTransactionConditions({ clientIds: [5, 6] });
    expect(conditions).toHaveLength(1);
    const { sql, params } = render(conditions);
    expect(sql).toContain("campaigns");
    expect(sql).toContain("client_id");
    expect(sql).toContain(" in (");
    expect(params).toEqual([5, 6]);
  });

  it("adds an inArray condition on campaigns.platform_id when partnerIds is non-empty", () => {
    const conditions = buildTransactionConditions({ partnerIds: [9] });
    expect(conditions).toHaveLength(1);
    const { sql, params } = render(conditions);
    expect(sql).toContain("campaigns");
    expect(sql).toContain("platform_id");
    expect(params).toEqual([9]);
  });

  it("adds an inArray condition on clients.buying_house_id when buyingHouseIds is non-empty", () => {
    const conditions = buildTransactionConditions({ buyingHouseIds: [2, 3] });
    expect(conditions).toHaveLength(1);
    const { sql, params } = render(conditions);
    expect(sql).toContain("clients");
    expect(sql).toContain("buying_house_id");
    expect(params).toEqual([2, 3]);
  });

  it("combines date range and all id filters together", () => {
    const conditions = buildTransactionConditions({
      dateFrom: "2026-01-01",
      clientIds: [1],
      partnerIds: [2],
      buyingHouseIds: [3],
    });
    expect(conditions).toHaveLength(4);
    const { params } = render(conditions);
    expect(params).toEqual(["2026-01-01", [1], [2], [3]].flat());
  });
});
