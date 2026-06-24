import { describe, it, expect } from "vitest";
import { lineBudget, totalBudget } from "./po-totals";

describe("lineBudget", () => {
  it("multiplies rate by count, rounded to 2 dp", () => {
    expect(lineBudget(0.8, 1000)).toBe(800);
    expect(lineBudget(0.2, 1000)).toBe(200);
    expect(lineBudget(0.075, 333)).toBe(24.98);
  });
});

describe("totalBudget", () => {
  it("sums line budgets, rounded to 2 dp", () => {
    expect(totalBudget([{ cacRate: 0.8, eventCount: 1000 }, { cacRate: 0.2, eventCount: 1000 }])).toBe(1000);
  });
  it("returns 0 for no items", () => {
    expect(totalBudget([])).toBe(0);
  });
});
