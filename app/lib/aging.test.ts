import { describe, it, expect } from "vitest";
import { computeAging } from "./aging";

const now = new Date("2026-02-01T00:00:00Z");
const d = (s: string) => new Date(s + "T00:00:00Z");

describe("computeAging", () => {
  it("green with days-to-settle when settled", () => {
    const r = computeAging({ start: d("2026-01-01"), termDays: 30, now, settled: true, settledAt: d("2026-01-13") });
    expect(r.color).toBe("green");
    expect(r.daysToSettle).toBe(12);
  });
  it("settled without settledAt has null daysToSettle", () => {
    const r = computeAging({ start: d("2026-01-01"), termDays: 30, now, settled: true });
    expect(r.color).toBe("green");
    expect(r.daysToSettle).toBeNull();
  });
  it("neutral when no term days", () => {
    expect(computeAging({ start: d("2026-01-01"), termDays: null, now, settled: false }).color).toBe("neutral");
  });
  it("neutral when no start", () => {
    expect(computeAging({ start: null, termDays: 30, now, settled: false }).color).toBe("neutral");
  });
  it("green at/under half term", () => {
    const r = computeAging({ start: d("2026-01-22"), termDays: 30, now, settled: false }); // elapsed 10
    expect(r.color).toBe("green"); expect(r.daysLeft).toBe(20); expect(r.overdue).toBe(false);
  });
  it("yellow past half, not overdue", () => {
    const r = computeAging({ start: d("2026-01-12"), termDays: 30, now, settled: false }); // elapsed 20
    expect(r.color).toBe("yellow"); expect(r.daysLeft).toBe(10); expect(r.overdue).toBe(false);
  });
  it("red once overdue (negative daysLeft)", () => {
    const r = computeAging({ start: d("2025-12-23"), termDays: 30, now, settled: false }); // elapsed 40
    expect(r.color).toBe("red"); expect(r.overdue).toBe(true); expect(r.daysLeft).toBe(-10);
  });
});
