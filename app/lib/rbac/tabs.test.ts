import { describe, it, expect } from "vitest";
import { visibleTabs, type TabNode } from "./tabs";

const tree: TabNode[] = [
  {
    id: "client", label: "Client", permission: "billings.client:view",
    children: [
      { id: "summary", label: "Summary", permission: "billings.client.summary:view" },
      { id: "detail", label: "Detail", permission: "billings.client.detail:view" },
    ],
  },
  { id: "partner", label: "Partner", permission: "billings.partner:view" },
];

describe("visibleTabs", () => {
  it("keeps only permitted leaves", () => {
    const can = (p: string) => p === "billings.partner:view";
    const out = visibleTabs(tree, can);
    expect(out.map((t) => t.id)).toEqual(["partner"]);
  });

  it("hides a parent whose children are all denied", () => {
    const can = (p: string) => p === "billings.client:view"; // parent yes, children no
    const out = visibleTabs(tree, can);
    expect(out).toEqual([]);
  });

  it("keeps a parent with at least one visible child", () => {
    const can = (p: string) =>
      p === "billings.client:view" || p === "billings.client.summary:view";
    const out = visibleTabs(tree, can);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("client");
    expect(out[0].children!.map((c) => c.id)).toEqual(["summary"]);
  });
});