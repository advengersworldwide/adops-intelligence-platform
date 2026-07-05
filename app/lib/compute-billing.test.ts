import { describe, it, expect } from "vitest";
import { computeBilling, whtGrossUpRate } from "./compute-billing";

describe("computeBilling — sample invoice, WHT off", () => {
  const r = computeBilling({
    events: [
      { eventCount: 1000, billableRate: 1.12, payoutRate: 0.90 },
      { eventCount: 1000, billableRate: 0.40, payoutRate: 0.32 },
    ],
    forexSellingRate: 280, forexBuyingRate: 295,
    remittanceTaxPct: 15, salesTaxPct: 15, withholdingTaxPct: 7,
    bulkDiscountPct: 20, whtApplied: false,
  });
  it("net totals", () => {
    expect(r.netTotalUsd).toBeCloseTo(1520, 2);
    expect(r.netTotalPkr).toBeCloseTo(425600, 2);
  });
  it("gross, sales tax, invoice", () => {
    expect(r.grossTotalPkr).toBeCloseTo(500705.88, 1);
    expect(r.salesTax).toBeCloseTo(75105.88, 1);
    expect(r.totalInvoice).toBeCloseTo(575811.76, 1);
  });
  it("deductions + net receivable", () => {
    expect(r.lessWht).toBeCloseTo(40306.82, 1);
    expect(r.lessSst).toBeCloseTo(75105.88, 1);
    expect(r.lessBd).toBeCloseTo(100141.18, 1);
    expect(r.netReceivable).toBeCloseTo(360257.88, 1);
  });
  it("payable + margin", () => {
    expect(r.netPayableUsd).toBeCloseTo(1220, 2);
    expect(r.netPayablePkr).toBeCloseTo(359900, 2);
    expect(r.netMargin).toBeCloseTo(357.88, 1);
  });
});

describe("whtGrossUpRate", () => {
  it("= ((1+ST)*WHT)/(1-((1+ST)*WHT))", () => {
    expect(whtGrossUpRate(15, 7)).toBeCloseTo(0.087548, 5);
  });
});

describe("computeBilling — WHT on grosses up the invoice", () => {
  const base = {
    events: [{ eventCount: 1000, billableRate: 1.12, payoutRate: 0.9 }],
    forexSellingRate: 280, forexBuyingRate: 295,
    remittanceTaxPct: 15, salesTaxPct: 15, withholdingTaxPct: 7, bulkDiscountPct: 20,
  };
  it("total invoice is higher when whtApplied", () => {
    const off = computeBilling({ ...base, whtApplied: false });
    const on = computeBilling({ ...base, whtApplied: true });
    expect(on.totalInvoice).toBeGreaterThan(off.totalInvoice);
    expect(on.grossTotalPkr).toBeCloseTo(off.grossTotalPkr * (1 + whtGrossUpRate(15, 7)), 4);
  });
});
