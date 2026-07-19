import { describe, it, expect } from "vitest";
import { buildFlow } from "./flow";

describe("buildFlow", () => {
  it("returns empty graph for no rows", () => {
    expect(buildFlow([])).toEqual({ nodes: [], links: [] });
  });
  it("builds client→bh→partner links, aggregating spend", () => {
    const g = buildFlow([
      { clientName: "A", buyingHouseName: "BH1", partnerName: "P1", spend: 100 },
      { clientName: "A", buyingHouseName: "BH1", partnerName: "P2", spend: 50 },
    ]);
    expect(g.nodes.map(n => n.name)).toEqual(["A", "BH1", "P1", "P2"]);
    // A->BH1 = 150, BH1->P1 = 100, BH1->P2 = 50
    const byName = (s: number, t: number) => g.links.find(l => l.source === s && l.target === t)?.value;
    expect(byName(0, 1)).toBe(150); // A -> BH1
    expect(byName(1, 2)).toBe(100); // BH1 -> P1
    expect(byName(1, 3)).toBe(50);  // BH1 -> P2
  });
  it("groups null buying house under (No Buying House)", () => {
    const g = buildFlow([{ clientName: "X", buyingHouseName: null, partnerName: "P", spend: 10 }]);
    expect(g.nodes.map(n => n.name)).toContain("(No Buying House)");
  });
});
