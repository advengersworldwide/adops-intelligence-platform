import { describe, it, expect } from "vitest";
import { fkEdges, dependentsOf, isBlocking, allTableNames } from "./dependency-graph";

function edge(child: string, parent: string) {
  return fkEdges.find(e => e.childTable === child && e.parentTable === parent);
}

describe("dependency graph", () => {
  it("derives restrict edges", () => {
    expect(edge("billings", "clients")?.onDelete).toBe("restrict");
    expect(edge("client_purchase_orders", "clients")?.onDelete).toBe("restrict");
    expect(edge("partner_bills", "partners")?.onDelete).toBe("restrict");
  });

  it("derives cascade edges", () => {
    expect(edge("billing_records", "partners")?.onDelete).toBe("cascade");
    expect(edge("client_events", "clients")?.onDelete).toBe("cascade");
    expect(edge("payment_billings", "payments")?.onDelete).toBe("cascade");
  });

  it("derives set null edges", () => {
    expect(edge("clients", "buying_houses")?.onDelete).toBe("set null");
    expect(edge("billing_records", "clients")?.onDelete).toBe("set null");
  });

  it("normalizes unspecified onDelete to 'no action' and treats it as blocking", () => {
    const e = edge("billing_records", "buying_houses");
    expect(e?.onDelete).toBe("no action");
    expect(isBlocking(e!.onDelete)).toBe(true);
  });

  it("treats restrict as blocking and cascade/set null as non-blocking", () => {
    expect(isBlocking("restrict")).toBe(true);
    expect(isBlocking("cascade")).toBe(false);
    expect(isBlocking("set null")).toBe(false);
  });

  it("indexes dependents by parent table", () => {
    const children = (dependentsOf.get("clients") ?? []).map(e => e.childTable);
    expect(children).toContain("billings");
    expect(children).toContain("client_events");
    expect(children).toContain("client_purchase_orders");
  });

  it("discovers every schema table", () => {
    expect(allTableNames).toContain("billings");
    expect(allTableNames).toContain("dashboard_layouts");
    expect(allTableNames.length).toBeGreaterThanOrEqual(24);
  });
});
