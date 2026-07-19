import { describe, it, expect } from "vitest";
import { percentDelta, marginPct } from "./metrics";

describe("metrics", () => {
  it("computes percent delta vs prior", () => {
    expect(percentDelta(120, 100)).toBeCloseTo(20, 6);
    expect(percentDelta(80, 100)).toBeCloseTo(-20, 6);
  });
  it("returns null delta when prior is zero (undefined growth)", () => {
    expect(percentDelta(50, 0)).toBeNull();
  });
  it("computes margin percent, guarding divide-by-zero", () => {
    expect(marginPct(30, 100)).toBeCloseTo(30, 6);
    expect(marginPct(30, 0)).toBe(0);
  });
});
