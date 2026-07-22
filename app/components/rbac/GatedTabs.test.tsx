import { describe, it, expect } from "vitest";
import { pickDefaultTab } from "./GatedTabs";
import type { TabNode } from "@/lib/rbac/tabs";

const nodes: TabNode[] = [
  { id: "a", label: "A", permission: "clients.details:view" },
  { id: "b", label: "B", permission: "clients.events:view" },
];

describe("pickDefaultTab", () => {
  it("returns the first visible leaf id", () => {
    expect(pickDefaultTab(nodes)).toBe("a");
  });
  it("descends into a nested parent for its first child id", () => {
    const nested: TabNode[] = [
      { id: "client", label: "Client", permission: "billings.client:view",
        children: [{ id: "summary", label: "S", permission: "billings.client.summary:view" }] },
    ];
    expect(pickDefaultTab(nested)).toBe("summary");
  });
  it("returns null when empty", () => {
    expect(pickDefaultTab([])).toBeNull();
  });
});
