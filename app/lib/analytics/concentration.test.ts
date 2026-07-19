import { describe, it, expect } from "vitest";
import { concentration } from "./concentration";

describe("concentration", () => {
  it("returns zeros for empty input", () => {
    expect(concentration([])).toEqual({ points: [], hhi: 0, top5Pct: 0 });
  });
  it("sorts desc, computes cumulative %, HHI, top5", () => {
    const c = concentration([
      { name: "A", revenue: 50 }, { name: "B", revenue: 30 }, { name: "C", revenue: 20 },
    ]); // total 100
    expect(c.points.map(p => p.name)).toEqual(["A", "B", "C"]);
    expect(c.points.map(p => p.cumulativePct)).toEqual([50, 80, 100]);
    expect(c.hhi).toBeCloseTo(50*50 + 30*30 + 20*20, 6); // 3800
    expect(c.top5Pct).toBe(100); // only 3 clients
  });
});
