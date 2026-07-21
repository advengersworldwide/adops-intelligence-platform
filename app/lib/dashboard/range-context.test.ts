import { describe, it, expect } from "vitest";
import { computePreset } from "./range-context";

describe("computePreset", () => {
  it("mtd returns first-of-month..today", () => {
    expect(computePreset("mtd", new Date("2026-07-21T00:00:00Z"))).toEqual({ dateFrom: "2026-07-01", dateTo: "2026-07-21" });
  });
  it("last30 spans 30 inclusive days", () => {
    expect(computePreset("last30", new Date("2026-07-30T00:00:00Z"))).toEqual({ dateFrom: "2026-07-01", dateTo: "2026-07-30" });
  });
});
