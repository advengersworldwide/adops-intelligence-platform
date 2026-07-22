import { describe, it, expect } from "vitest";
import { visibleWidgetIds } from "./role-gating";
import type { WidgetDef } from "./types";

const def = (id: string, permission: WidgetDef["permission"]): WidgetDef => ({
  id, label: id, description: "", category: "kpi", permission,
  defaultLayout: { w: 3, h: 3, minW: 2, minH: 2 }, Component: () => null,
});
const registry = {
  "revenue-kpi": def("revenue-kpi", null),
  "cost-kpi": def("cost-kpi", "cost:view"),
  "aging": def("aging", "payments:view"),
};

describe("visibleWidgetIds", () => {
  it("keeps null-permission widgets and drops ones the user lacks", () => {
    const has = (p: string) => p === "cost:view";
    expect(visibleWidgetIds(["revenue-kpi", "cost-kpi", "aging"], registry, has))
      .toEqual(["revenue-kpi", "cost-kpi"]);
  });
  it("drops ids not present in the registry", () => {
    expect(visibleWidgetIds(["revenue-kpi", "ghost"], registry, () => true)).toEqual(["revenue-kpi"]);
  });
});
