import { describe, it, expect } from "vitest";
import { detectAnomalies } from "./anomalies";

describe("detectAnomalies", () => {
  it("empty → []", () => { expect(detectAnomalies([])).toEqual([]); });
  it("flat series → no anomalies, z=0", () => {
    const r = detectAnomalies([5, 5, 5, 5], 2.5);
    expect(r.every(p => p.z === 0 && !p.isAnomaly)).toBe(true);
  });
  it("flags a clear outlier", () => {
    const r = detectAnomalies([1, 1, 1, 1, 1, 1, 1, 1, 1, 20], 2);
    expect(r[9].isAnomaly).toBe(true);
    expect(r.slice(0, 9).every(p => !p.isAnomaly)).toBe(true);
  });
});
