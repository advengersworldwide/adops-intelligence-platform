import { describe, it, expect } from "vitest";
import { buildWaterfall, billingLineResults, type BillingRates, type LineEvents } from "./waterfall";
import { computeBilling, type ComputeBillingInput } from "@/lib/compute-billing";

const billing: ComputeBillingInput = {
  events: [{ eventCount: 100, billableRate: 5, payoutRate: 3 }],
  forexSellingRate: 280, forexBuyingRate: 275,
  remittanceTaxPct: 0, salesTaxPct: 0, withholdingTaxPct: 0, bulkDiscountPct: 0, whtApplied: false,
};

describe("buildWaterfall", () => {
  it("produces monotonic decreasing stages from total invoice to net margin", () => {
    const w = buildWaterfall([computeBilling(billing)]);
    const totalInvoice = w.find((s) => s.key === "totalInvoice")!.value;
    const netMargin = w.find((s) => s.key === "netMargin")!.value;
    expect(totalInvoice).toBeGreaterThan(netMargin);
    // 100*5*280 = 140000 invoice; payout 100*3*275 = 82500; margin 57500
    expect(totalInvoice).toBeCloseTo(140000, 2);
    expect(netMargin).toBeCloseTo(57500, 2);
  });
  it("sums stages across multiple billings", () => {
    const w = buildWaterfall([computeBilling(billing), computeBilling(billing)]);
    expect(w.find((s) => s.key === "totalInvoice")!.value).toBeCloseTo(280000, 2);
  });
});

describe("billingLineResults", () => {
  const rates: BillingRates = {
    forexSellingRate: 280, forexBuyingRate: 275,
    remittanceTaxPct: 2, salesTaxPct: 15, withholdingTaxPct: 4, bulkDiscountPct: 1,
    whtApplied: true,
  };
  const lines: LineEvents[] = [
    { events: [{ eventCount: 100, billableRate: 5, payoutRate: 3 }] },
    { events: [{ eventCount: 50, billableRate: 8, payoutRate: 6 }, { eventCount: 20, billableRate: 2, payoutRate: 1 }] },
  ];

  it("maps each line through computeBilling with the billing's shared rates", () => {
    const results = billingLineResults(rates, lines);
    expect(results).toHaveLength(2);

    // Expected: apply computeBilling directly to each line's events with the same rates,
    // proving the helper doesn't drop lines or leak rates across lines.
    const expected = lines.map((line) => computeBilling({ events: line.events, ...rates }));
    expect(results).toEqual(expected);

    const expectedNetMargin = expected.reduce((s, r) => s + r.netMargin, 0);
    const w = buildWaterfall(results);
    expect(w.find((s) => s.key === "netMargin")!.value).toBeCloseTo(expectedNetMargin, 6);
  });
});
