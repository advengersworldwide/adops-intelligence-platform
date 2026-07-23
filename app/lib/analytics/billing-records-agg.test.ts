import { describe, it, expect } from "vitest";
import { aggregateTotals, aggregateBy, type AggRecord } from "./billing-records-agg";

const rec = (over: Partial<AggRecord> = {}): AggRecord => ({
  clientId: 1, platformId: 1, buyingHouseId: 1, period: "2026-06",
  pins: 100, fraudPins: 0, payoutRate: "1", marginPct: "20",
  forexSellingRate: "1", forexBuyingRate: "1", salesTaxPct: "0",
  remittanceTaxPct: "0", withholdingTaxPct: "0", bulkDiscountPct: "0", platformBulkDiscountPct: "0",
  ...over,
});

describe("aggregateTotals", () => {
  it("sums computeRow revenue/cost/profit and derives margin", () => {
    const t = aggregateTotals([rec(), rec()]);
    // per record: netAmtUsd=100, receivable=125 (100/0.8), payable=80 (100*0.8) => profit 45
    expect(t.revenue).toBeCloseTo(250);
    expect(t.cost).toBeCloseTo(160);
    expect(t.profit).toBeCloseTo(90);
    expect(t.marginPct).toBeCloseTo(36); // 90/250*100
  });
  it("returns zeros (margin 0) for empty input", () => {
    expect(aggregateTotals([])).toEqual({ revenue: 0, cost: 0, profit: 0, marginPct: 0 });
  });
});

describe("aggregateBy", () => {
  it("groups by a key function", () => {
    const g = aggregateBy([rec({ clientId: 1 }), rec({ clientId: 2 }), rec({ clientId: 1 })], (r) => r.clientId);
    expect(g.get(1)!.revenue).toBeCloseTo(250);
    expect(g.get(2)!.revenue).toBeCloseTo(125);
  });
});
