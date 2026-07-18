// app/lib/import/descriptors/partner-payments.test.ts
import { describe, it, expect, vi } from "vitest";

// The descriptor (after Task 2) imports @workspace/db, which throws at module-load
// without DATABASE_URL. Mock it so the pure resolveRow tests can load/run.
vi.mock("@workspace/db", () => ({ db: {}, partnerPaymentsTable: {}, partnerBillsTable: {} }));

import { partnerPaymentsDescriptor as d, type PpayContext } from "./partner-payments";

function ctx(over: Partial<PpayContext> = {}): PpayContext {
  return {
    billByCode: new Map([["PBILL-ACME-0126-0001", { id: 5, partnerId: 3, amount: 1500, remaining: 1500 }]]),
    existingDedupKeys: new Set<string>(),
    batchAllocated: new Map<number, number>(),
    ...over,
  };
}
const cells = (o: Partial<Record<string, string>>) => ({
  partnerBillCode: "", amount: "", status: "", mode: "", paymentDate: "", notes: "", ...o,
});

describe("partnerPayments.resolveRow", () => {
  it("resolves a valid payment, deriving partnerId from the bill", () => {
    const r = d.resolveRow(cells({ partnerBillCode: "PBILL-ACME-0126-0001", amount: "500.00", status: "settled", mode: "wire" }), 1, ctx(), new Set());
    expect(r.status).toBe("valid");
    expect(r.payload).toMatchObject({ partnerId: 3, partnerBillId: 5, amount: 500, status: "settled", mode: "wire" });
  });

  it("defaults status to pending when blank", () => {
    const r = d.resolveRow(cells({ partnerBillCode: "PBILL-ACME-0126-0001", amount: "10" }), 1, ctx(), new Set());
    expect(r.status).toBe("valid");
    expect(r.payload!.status).toBe("pending");
  });

  it("errors on unknown bill code", () => {
    const r = d.resolveRow(cells({ partnerBillCode: "PBILL-X-0000-0000", amount: "10" }), 1, ctx(), new Set());
    expect(r.status).toBe("error");
    expect(r.messages[0]).toContain("Unknown partner bill");
  });

  it("errors on a non-positive or non-finite amount", () => {
    expect(d.resolveRow(cells({ partnerBillCode: "PBILL-ACME-0126-0001", amount: "0" }), 1, ctx(), new Set()).status).toBe("error");
    expect(d.resolveRow(cells({ partnerBillCode: "PBILL-ACME-0126-0001", amount: "Infinity" }), 1, ctx(), new Set()).status).toBe("error");
    expect(d.resolveRow(cells({ partnerBillCode: "PBILL-ACME-0126-0001", amount: "" }), 1, ctx(), new Set()).status).toBe("error");
  });

  it("errors on an invalid status", () => {
    const r = d.resolveRow(cells({ partnerBillCode: "PBILL-ACME-0126-0001", amount: "10", status: "approved" }), 1, ctx(), new Set());
    expect(r.status).toBe("error");
    expect(r.messages[0]).toContain("Invalid status");
  });

  it("errors when a single payment exceeds the bill remaining", () => {
    const c = ctx({ billByCode: new Map([["PBILL-ACME-0126-0001", { id: 5, partnerId: 3, amount: 1500, remaining: 400 }]]) });
    const r = d.resolveRow(cells({ partnerBillCode: "PBILL-ACME-0126-0001", amount: "500" }), 1, c, new Set());
    expect(r.status).toBe("error");
    expect(r.messages[0]).toContain("exceeds remaining");
  });

  it("errors when cumulative in-batch payments exceed the bill remaining", () => {
    const c = ctx(); // remaining 1500
    const seen = new Set<string>();
    const a = d.resolveRow(cells({ partnerBillCode: "PBILL-ACME-0126-0001", amount: "1000" }), 1, c, seen);
    const b = d.resolveRow(cells({ partnerBillCode: "PBILL-ACME-0126-0001", amount: "800" }), 2, c, seen);
    expect(a.status).toBe("valid");
    expect(b.status).toBe("error");
    expect(b.messages[0]).toContain("exceeds remaining");
  });

  it("skips a duplicate of an existing payment (same bill, amount & date)", () => {
    const c = ctx({ existingDedupKeys: new Set(["5|500|2026-02-05"]) });
    const r = d.resolveRow(cells({ partnerBillCode: "PBILL-ACME-0126-0001", amount: "500", paymentDate: "2026-02-05" }), 1, c, new Set());
    expect(r.status).toBe("skip");
  });
});
