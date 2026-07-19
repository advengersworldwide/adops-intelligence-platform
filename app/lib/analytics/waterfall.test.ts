import { describe, it, expect } from "vitest";
import { buildWaterfall } from "./waterfall";
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
