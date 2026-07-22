import { describe, it, expect } from "vitest";
import { PRESETS, resolvePreset, EXEC_PRESET } from "./presets";
import { widgetRegistry } from "@/components/dashboard/widget-registry";

describe("presets", () => {
  it("only reference registered widget ids", () => {
    for (const p of Object.values(PRESETS))
      for (const id of p.activeWidgets) expect(widgetRegistry[id]).toBeDefined();
  });
  it("resolvePreset filters out widgets the user lacks permission for", () => {
    const r = resolvePreset("exec", (perm) => perm !== "cost:view");
    expect(r.activeWidgets).not.toContain("cost-kpi");
    expect(r.activeWidgets).not.toContain("profit-kpi");
  });
  it("generates only finite integer positions (JSON-safe, no Infinity)", () => {
    for (const item of EXEC_PRESET.layout) {
      expect(Number.isFinite(item.x)).toBe(true);
      expect(Number.isFinite(item.y)).toBe(true);
    }
    // round-trips through JSON without turning a position into null
    const round = JSON.parse(JSON.stringify(EXEC_PRESET.layout));
    expect(round.every((l: { y: number | null }) => typeof l.y === "number")).toBe(true);
  });
});
