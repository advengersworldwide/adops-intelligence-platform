// app/lib/import/descriptors/client-purchase-orders.test.ts
import { describe, it, expect, vi } from "vitest";
import { clientPurchaseOrdersDescriptor as d, type CpoContext } from "./client-purchase-orders";

vi.mock("@workspace/db", () => ({ db: {}, clientsTable: {}, clientPurchaseOrdersTable: {} }));

function ctx(overrides: Partial<CpoContext> = {}): CpoContext {
  return {
    clientsByName: new Map([["acme", [{ id: 7, codePrefix: "ACME" }]]]),
    existingKeys: new Set<string>(),
    maxSeqByGroup: new Map<string, number>(),
    ...overrides,
  };
}
const cells = (o: Partial<Record<string, string>>) => ({
  clientName: "", receiveDate: "", startDate: "", endDate: "", ...o,
});

describe("clientPurchaseOrders.resolveRow", () => {
  it("resolves a valid row to a payload", () => {
    const r = d.resolveRow(cells({ clientName: "Acme", receiveDate: "2026-01-05" }), 1, ctx(), new Set());
    expect(r.status).toBe("valid");
    expect(r.payload).toMatchObject({ clientId: 7, prefix: "ACME", receiveDate: "2026-01-05" });
  });

  it("errors on an unknown client", () => {
    const r = d.resolveRow(cells({ clientName: "Nope" }), 1, ctx(), new Set());
    expect(r.status).toBe("error");
    expect(r.messages[0]).toContain("Unknown client");
  });

  it("errors on an ambiguous client name", () => {
    const c = ctx({ clientsByName: new Map([["acme", [{ id: 7, codePrefix: "ACME" }, { id: 8, codePrefix: "ACM2" }]]]) });
    const r = d.resolveRow(cells({ clientName: "Acme" }), 1, c, new Set());
    expect(r.status).toBe("error");
    expect(r.messages[0]).toContain("Ambiguous");
  });

  it("errors when the client has no code prefix", () => {
    const c = ctx({ clientsByName: new Map([["acme", [{ id: 7, codePrefix: "" }]]]) });
    const r = d.resolveRow(cells({ clientName: "Acme" }), 1, c, new Set());
    expect(r.status).toBe("error");
    expect(r.messages[0]).toContain("PO code prefix");
  });

  it("errors when startDate is after endDate", () => {
    const r = d.resolveRow(cells({ clientName: "Acme", startDate: "2026-03-01", endDate: "2026-02-01" }), 1, ctx(), new Set());
    expect(r.status).toBe("error");
    expect(r.messages[0]).toContain("after");
  });

  it("skips a row matching an existing PO (dedup key)", () => {
    const c = ctx({ existingKeys: new Set(["7|2026-01-05||"]) });
    const r = d.resolveRow(cells({ clientName: "Acme", receiveDate: "2026-01-05" }), 1, c, new Set());
    expect(r.status).toBe("skip");
    expect(r.messages[0]).toContain("existing PO");
  });

  it("skips an in-file duplicate", () => {
    const seen = new Set<string>();
    const first = d.resolveRow(cells({ clientName: "Acme", receiveDate: "2026-01-05" }), 1, ctx(), seen);
    const second = d.resolveRow(cells({ clientName: "Acme", receiveDate: "2026-01-05" }), 2, ctx(), seen);
    expect(first.status).toBe("valid");
    expect(second.status).toBe("skip");
    expect(second.messages[0]).toContain("Duplicate row in file");
  });

  it("does not dedup rows that have no dates at all", () => {
    const seen = new Set<string>();
    const first = d.resolveRow(cells({ clientName: "Acme" }), 1, ctx(), seen);
    const second = d.resolveRow(cells({ clientName: "Acme" }), 2, ctx(), seen);
    expect(first.status).toBe("valid");
    expect(second.status).toBe("valid");
  });
});
