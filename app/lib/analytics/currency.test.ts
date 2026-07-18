import { describe, it, expect } from "vitest";
import { convertTo, formatMoney, DEFAULT_RATES } from "./currency";

describe("currency", () => {
  it("converts from a currency to base using rate division", () => {
    // 92 EUR at rate 0.92 => 100 base
    expect(convertTo(92, "EUR", { ...DEFAULT_RATES, eur: 0.92 })).toBeCloseTo(100, 6);
  });
  it("returns the amount unchanged for an unknown currency", () => {
    expect(convertTo(50, "XYZ", DEFAULT_RATES)).toBe(50);
  });
  it("formats compact money with a currency prefix", () => {
    expect(formatMoney(1500, "USD")).toBe("$1.5K");
    expect(formatMoney(-2_000_000, "USD")).toBe("-$2.0M");
  });
});
