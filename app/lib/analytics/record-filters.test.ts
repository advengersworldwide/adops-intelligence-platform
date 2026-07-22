import { describe, it, expect } from "vitest";
import { monthOf } from "./record-filters";

describe("monthOf", () => {
  it("maps an ISO date to its YYYY-MM period", () => {
    expect(monthOf("2026-06-15")).toBe("2026-06");
    expect(monthOf(null)).toBeNull();
  });
});
