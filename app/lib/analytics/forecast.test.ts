import { describe, it, expect } from "vitest";
import { linearForecast } from "./forecast";

describe("linearForecast", () => {
  it("continues a perfect linear trend with ~0 band", () => {
    const f = linearForecast([10, 20, 30, 40], 2); // slope 10, next indices 4,5 → 50,60
    expect(f).toHaveLength(2);
    expect(f[0].value).toBeCloseTo(50, 6);
    expect(f[1].value).toBeCloseTo(60, 6);
    expect(f[0].lower).toBeCloseTo(50, 6); // perfect fit → zero residual
    expect(f[0].upper).toBeCloseTo(50, 6);
  });
  it("returns horizon flat points for too-short input", () => {
    expect(linearForecast([42], 3)).toEqual([
      { value: 42, lower: 42, upper: 42 },
      { value: 42, lower: 42, upper: 42 },
      { value: 42, lower: 42, upper: 42 },
    ]);
    expect(linearForecast([], 2)).toEqual([
      { value: 0, lower: 0, upper: 0 }, { value: 0, lower: 0, upper: 0 },
    ]);
  });
});
