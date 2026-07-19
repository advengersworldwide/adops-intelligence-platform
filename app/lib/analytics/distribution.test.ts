import { describe, it, expect } from "vitest";
import { bucketMargins } from "./distribution";

describe("bucketMargins", () => {
  it("returns empty for no values", () => { expect(bucketMargins([], 10)).toEqual([]); });
  it("buckets values into contiguous fixed-width bins", () => {
    const b = bucketMargins([-5, 3, 12, 45, 47], 10);
    // bins from -10 up through 40..50, contiguous
    expect(b.map(x => x.min)).toEqual([-10, 0, 10, 20, 30, 40]);
    expect(b.map(x => x.count)).toEqual([1, 1, 1, 0, 0, 2]);
    expect(b[0].isNegative).toBe(true);
    expect(b[1].isNegative).toBe(false);
    expect(b[0].label).toBe("-10–0%");
    expect(b[5].label).toBe("40–50%");
  });
});
