import { describe, it, expect } from "vitest";
import { buildAnalyticsParams, type AnalyticsFilters } from "./filters";

const base: AnalyticsFilters = {
  dateFrom: "2026-01-01", dateTo: "2026-03-31",
  engine: "combined", clientIds: [], partnerIds: [], buyingHouseIds: [],
  costModelId: null, poId: null, status: null, compare: false,
};

describe("buildAnalyticsParams", () => {
  it("omits empty arrays and null values", () => {
    expect(buildAnalyticsParams(base)).toEqual({
      dateFrom: "2026-01-01", dateTo: "2026-03-31", engine: "combined", compare: false,
    });
  });
  it("serializes id arrays as comma-separated strings", () => {
    expect(buildAnalyticsParams({ ...base, clientIds: [1, 2, 3] }).clientIds).toBe("1,2,3");
  });
});
