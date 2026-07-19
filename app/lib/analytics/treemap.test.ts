import { describe, it, expect } from "vitest";
import { buildTreemap } from "./treemap";

describe("buildTreemap", () => {
  it("empty → []", () => {
    expect(buildTreemap([])).toEqual([]);
  });
  it("nests partners under clients by revenue", () => {
    const t = buildTreemap([
      { client: "A", partner: "P1", revenue: 100 },
      { client: "A", partner: "P2", revenue: 50 },
      { client: "B", partner: "P1", revenue: 30 },
      { client: "B", partner: "P3", revenue: 0 }, // skipped (revenue<=0)
    ]);
    expect(t).toEqual([
      { name: "A", children: [{ name: "P1", size: 100 }, { name: "P2", size: 50 }] },
      { name: "B", children: [{ name: "P1", size: 30 }] },
    ]);
  });
});
