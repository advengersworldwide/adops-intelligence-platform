// app/lib/import/descriptors/partner-bills.test.ts
import { describe, it, expect, vi } from "vitest";

// The descriptor (after Task 2) imports @workspace/db, which throws at module-load
// without DATABASE_URL. Mock it so the pure resolveRow tests can load/run.
vi.mock("@workspace/db", () => ({
  db: {}, partnerBillsTable: {}, partnersTable: {}, clientsTable: {}, partnerPurchaseOrdersTable: {},
}));

import { partnerBillsDescriptor as d, type PbillContext } from "./partner-bills";

function ctx(over: Partial<PbillContext> = {}): PbillContext {
  return {
    partnersByName: new Map([["acme media", [{ id: 3, codePrefix: "ACME" }]]]),
    clientsByName: new Map([["beta llc", [{ id: 7 }]]]),
    ppoByCode: new Map([["PPO-ACME-0126-0001", { id: 11 }]]),
    existingKeys: new Set<string>(),
    maxSeqByGroup: new Map<string, number>(),
    scopePartnerId: null,
    ...over,
  };
}
const cells = (o: Partial<Record<string, string>>) => ({
  partnerName: "", amount: "", partnerInvoiceNumber: "", clientName: "", partnerPoCode: "", dateReceived: "", notes: "", ...o,
});

describe("partnerBills.resolveRow", () => {
  it("resolves a minimal valid row", () => {
    const r = d.resolveRow(cells({ partnerName: "Acme Media", amount: "1500.50" }), 1, ctx(), new Set());
    expect(r.status).toBe("valid");
    expect(r.payload).toMatchObject({ partnerId: 3, prefix: "ACME", amount: 1500.5, clientId: null, partnerPurchaseOrderId: null, partnerInvoiceNumber: null });
  });

  it("resolves optional client + partner PO", () => {
    const r = d.resolveRow(cells({ partnerName: "Acme Media", amount: "10", clientName: "Beta LLC", partnerPoCode: "PPO-ACME-0126-0001", partnerInvoiceNumber: "INV-9" }), 1, ctx(), new Set());
    expect(r.status).toBe("valid");
    expect(r.payload).toMatchObject({ clientId: 7, partnerPurchaseOrderId: 11, partnerInvoiceNumber: "INV-9" });
  });

  it("errors on unknown partner", () => {
    const r = d.resolveRow(cells({ partnerName: "Nope", amount: "10" }), 1, ctx(), new Set());
    expect(r.status).toBe("error");
    expect(r.messages[0]).toContain("Unknown partner");
  });

  it("errors when partner has no code prefix", () => {
    const c = ctx({ partnersByName: new Map([["acme media", [{ id: 3, codePrefix: "" }]]]) });
    const r = d.resolveRow(cells({ partnerName: "Acme Media", amount: "10" }), 1, c, new Set());
    expect(r.status).toBe("error");
    expect(r.messages[0]).toContain("code prefix");
  });

  it("errors on a non-finite or negative amount", () => {
    expect(d.resolveRow(cells({ partnerName: "Acme Media", amount: "Infinity" }), 1, ctx(), new Set()).status).toBe("error");
    expect(d.resolveRow(cells({ partnerName: "Acme Media", amount: "-5" }), 1, ctx(), new Set()).status).toBe("error");
    expect(d.resolveRow(cells({ partnerName: "Acme Media", amount: "" }), 1, ctx(), new Set()).status).toBe("error");
  });

  it("errors on a provided-but-unknown client", () => {
    const r = d.resolveRow(cells({ partnerName: "Acme Media", amount: "10", clientName: "Ghost" }), 1, ctx(), new Set());
    expect(r.status).toBe("error");
    expect(r.messages[0]).toContain("Unknown client");
  });

  it("errors on a provided-but-unknown partner PO code", () => {
    const r = d.resolveRow(cells({ partnerName: "Acme Media", amount: "10", partnerPoCode: "PPO-X-0000-0000" }), 1, ctx(), new Set());
    expect(r.status).toBe("error");
    expect(r.messages[0]).toContain("Unknown partner PO");
  });

  it("skips a duplicate of an existing bill (same partner + invoice number)", () => {
    const c = ctx({ existingKeys: new Set(["3|inv-9"]) });
    const r = d.resolveRow(cells({ partnerName: "Acme Media", amount: "10", partnerInvoiceNumber: "INV-9" }), 1, c, new Set());
    expect(r.status).toBe("skip");
  });

  it("does not dedup rows without an invoice number", () => {
    const seen = new Set<string>();
    const a = d.resolveRow(cells({ partnerName: "Acme Media", amount: "10" }), 1, ctx(), seen);
    const b = d.resolveRow(cells({ partnerName: "Acme Media", amount: "10" }), 2, ctx(), seen);
    expect(a.status).toBe("valid");
    expect(b.status).toBe("valid");
  });
});