import { describe, it, expect } from "vitest";
import { priorRange } from "./date-range";

describe("priorRange", () => {
  it("returns the immediately preceding equal-length window (inclusive dates)", () => {
    // 2026-06-01..2026-06-30 is 30 days -> prior is 2026-05-02..2026-05-31
    expect(priorRange("2026-06-01", "2026-06-30")).toEqual({ from: "2026-05-02", to: "2026-05-31" });
  });
  it("handles a single-day range", () => {
    expect(priorRange("2026-06-10", "2026-06-10")).toEqual({ from: "2026-06-09", to: "2026-06-09" });
  });
});
