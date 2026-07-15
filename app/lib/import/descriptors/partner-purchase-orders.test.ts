// app/lib/import/descriptors/partner-purchase-orders.test.ts
import { describe, it, expect, vi } from "vitest";

// The descriptor (after Task 4) imports @workspace/db, which throws at module-load
// without DATABASE_URL. Mock it so the pure resolveGroup tests can load/run.
vi.mock("@workspace/db", () => ({
  db: {}, partnerPurchaseOrdersTable: {}, partnerPurchaseOrderItemsTable: {},
  partnersTable: {}, clientPurchaseOrdersTable: {}, clientEventsTable: {},
}));

import { partnerPurchaseOrdersDescriptor as d, type PpoContext } from "./partner-purchase-orders";

function ctx(over: Partial<PpoContext> = {}): PpoContext {
  return {
    partnersByName: new Map([["acme media", [{ id: 3, codePrefix: "ACME" }]]]),
    cpoByCode: new Map([["CPO-ACME-0126-0001", { id: 11, clientId: 7 }]]),
    eventsByClientAndName: new Map([
      ["7|install", [{ id: 21 }]],
      ["7|signup", [{ id: 22 }]],
    ]),
    existingKeys: new Set<string>(),
    maxSeqByGroup: new Map<string, number>(),
    ...over,
  };
}
const row = (o: Partial<Record<string, string>>, rowNumber: number) => ({
  cells: { poReference: "PO-1", partnerName: "", clientPoCode: "", startDate: "", endDate: "", notes: "", eventName: "", cacRate: "", eventCount: "", ...o },
  rowNumber,
});

describe("partnerPurchaseOrders.resolveGroup", () => {
  const header = { partnerName: "Acme Media", clientPoCode: "CPO-ACME-0126-0001", startDate: "2026-01-10", endDate: "2026-02-10" };

  it("resolves a multi-item group into one payload", () => {
    const r = d.resolveGroup([
      row({ ...header, eventName: "Install", cacRate: "2.5", eventCount: "1000" }, 1),
      row({ ...header, eventName: "Signup", cacRate: "1", eventCount: "500" }, 2),
    ], ctx(), new Set());
    expect(r.status).toBe("valid");
    expect(r.payload).toMatchObject({ partnerId: 3, prefix: "ACME", clientPurchaseOrderId: 11 });
    expect(r.payload!.items).toHaveLength(2);
    expect(r.payload!.items[0]).toMatchObject({ clientEventId: 21, cacRate: 2.5, eventCount: 1000 });
  });

  it("errors on unknown partner", () => {
    const r = d.resolveGroup([row({ ...header, partnerName: "Nope", eventName: "Install", cacRate: "1", eventCount: "1" }, 1)], ctx(), new Set());
    expect(r.status).toBe("error");
    expect(r.messages[0]).toContain("Unknown partner");
  });

  it("errors on unknown client PO code", () => {
    const r = d.resolveGroup([row({ ...header, clientPoCode: "CPO-X-0000-0000", eventName: "Install", cacRate: "1", eventCount: "1" }, 1)], ctx(), new Set());
    expect(r.status).toBe("error");
    expect(r.messages[0]).toContain("Unknown client PO");
  });

  it("errors on an unknown event for the client", () => {
    const r = d.resolveGroup([row({ ...header, eventName: "Ghost", cacRate: "1", eventCount: "1" }, 1)], ctx(), new Set());
    expect(r.status).toBe("error");
    expect(r.messages[0]).toContain("Unknown event");
  });

  it("errors on conflicting header within the group", () => {
    const r = d.resolveGroup([
      row({ ...header, eventName: "Install", cacRate: "1", eventCount: "1" }, 1),
      row({ ...header, endDate: "2026-03-01", eventName: "Signup", cacRate: "1", eventCount: "1" }, 2),
    ], ctx(), new Set());
    expect(r.status).toBe("error");
    expect(r.messages[0]).toContain("Conflicting");
  });

  it("errors when start is after end", () => {
    const r = d.resolveGroup([row({ ...header, startDate: "2026-03-01", endDate: "2026-02-01", eventName: "Install", cacRate: "1", eventCount: "1" }, 1)], ctx(), new Set());
    expect(r.status).toBe("error");
    expect(r.messages[0]).toContain("after");
  });

  it("skips a group matching an existing partner PO", () => {
    const c = ctx({ existingKeys: new Set(["3|11|2026-01-10|2026-02-10"]) });
    const r = d.resolveGroup([row({ ...header, eventName: "Install", cacRate: "1", eventCount: "1" }, 1)], c, new Set());
    expect(r.status).toBe("skip");
  });

  it("errors on an invalid event count", () => {
    const r = d.resolveGroup([row({ ...header, eventName: "Install", cacRate: "1", eventCount: "1.5" }, 1)], ctx(), new Set());
    expect(r.status).toBe("error");
    expect(r.messages[0]).toContain("Event Count");
  });
});