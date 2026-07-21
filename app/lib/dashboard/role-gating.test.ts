import { describe, it, expect } from "vitest";
import { visibleWidgetIds } from "./role-gating";
import type { WidgetDef } from "./types";

const def = (id: string, permission: string | null): WidgetDef => ({
  id, label: id, description: "", category: "kpi", permission,
  defaultLayout: { w: 3, h: 3, minW: 2, minH: 2 }, Component: () => null,
});
const registry = {
  "revenue-kpi": def("revenue-kpi", null),
  "cost-kpi": def("cost-kpi", "View Cost"),
  "aging": def("aging", "View Payments"),
};

describe("visibleWidgetIds", () => {
  it("keeps null-permission widgets and drops ones the user lacks", () => {
    const has = (p: string) => p === "View Cost";
    expect(visibleWidgetIds(["revenue-kpi", "cost-kpi", "aging"], registry, has))
      .toEqual(["revenue-kpi", "cost-kpi"]);
  });
  it("drops ids not present in the registry", () => {
    expect(visibleWidgetIds(["revenue-kpi", "ghost"], registry, () => true)).toEqual(["revenue-kpi"]);
  });
});