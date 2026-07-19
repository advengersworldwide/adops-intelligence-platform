import { describe, it, expect } from "vitest";
import { runningBalance } from "./cashflow";

describe("runningBalance", () => {
  it("accumulates balance in date order", () => {
    const pts = runningBalance([
      { date: "2026-02-01", inflow: 100, outflow: 40, fundedOut: 40, unfundedOut: 0 },
      { date: "2026-01-01", inflow: 50, outflow: 20, fundedOut: 0, unfundedOut: 20 },
    ]);
    expect(pts.map(p => p.date)).toEqual(["2026-01-01", "2026-02-01"]);
    expect(pts.map(p => p.balance)).toEqual([30, 90]); // 50-20=30, +100-40=90
  });
  it("returns [] for empty input", () => { expect(runningBalance([])).toEqual([]); });
});
