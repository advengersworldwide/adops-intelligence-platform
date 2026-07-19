import { describe, it, expect } from "vitest";
import { pace } from "./pacing";

describe("pace", () => {
  it("computes ideal-to-date and overpace at the window midpoint", () => {
    // 100-day window, budget 1000, 50 days elapsed → ideal 500
    const r = pace(600, 1000, "2026-01-01", "2026-04-11", new Date("2026-02-20T00:00:00Z"));
    expect(r.totalDays).toBe(100);
    expect(r.elapsedDays).toBe(50);
    expect(r.idealToDate).toBeCloseTo(500, 6);
    expect(r.overpacePct).toBeCloseTo(20, 6); // 600 vs 500
    expect(r.pctConsumed).toBeCloseTo(60, 6);
    expect(r.projectedExhaustion).not.toBeNull();
  });
  it("returns null projection when nothing consumed", () => {
    expect(pace(0, 1000, "2026-01-01", "2026-04-11", new Date("2026-02-20T00:00:00Z")).projectedExhaustion).toBeNull();
  });
});
