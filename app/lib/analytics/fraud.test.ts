import { describe, it, expect } from "vitest";
import { fraudRate, buildFraudSeries } from "./fraud";

describe("fraud", () => {
  it("fraudRate guards divide-by-zero", () => {
    expect(fraudRate(10, 100)).toBeCloseTo(10, 6);
    expect(fraudRate(5, 0)).toBe(0);
  });
  it("aggregates rows by period, sorted, with valid pins + rate", () => {
    const s = buildFraudSeries([
      { period: "2026-02", appsflyerPins: 100, fraudPins: 10 },
      { period: "2026-01", appsflyerPins: 200, fraudPins: 20 },
      { period: "2026-02", appsflyerPins: 100, fraudPins: 30 }, // same period → sums
    ]);
    expect(s.map(p => p.period)).toEqual(["2026-01", "2026-02"]);
    const feb = s.find(p => p.period === "2026-02")!;
    expect(feb.appsflyerPins).toBe(200);
    expect(feb.fraudPins).toBe(40);
    expect(feb.validPins).toBe(160);
    expect(feb.fraudRatePct).toBeCloseTo(20, 6);
  });
});
