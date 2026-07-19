import { describe, it, expect } from "vitest";
import { buildMatrix } from "./matrix";

describe("buildMatrix", () => {
  it("empty input → empty matrix", () => {
    expect(buildMatrix([])).toEqual({ clients: [], partners: [], cells: [] });
  });
  it("collects distinct clients/partners and computes margin", () => {
    const m = buildMatrix([
      { client: "A", partner: "P1", spend: 100, profit: 30 },
      { client: "A", partner: "P2", spend: 200, profit: 40 },
      { client: "B", partner: "P1", spend: 50, profit: 0 },
    ]);
    expect(m.clients).toEqual(["A", "B"]);
    expect(m.partners).toEqual(["P1", "P2"]);
    const cell = m.cells.find(c => c.client === "A" && c.partner === "P1")!;
    expect(cell.marginPct).toBeCloseTo(30, 6);
    expect(cell.revenue).toBe(100);
    expect(m.cells.find(c => c.client === "B" && c.partner === "P1")!.marginPct).toBe(0);
  });
});
