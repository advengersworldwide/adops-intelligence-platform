// app/app/api/import/[type]/partner-route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// RBAC: routes now enforce permissions; bypass the guard in unit tests.
vi.mock("@/lib/auth/require", () => ({
  requirePermission: async () => ({ user: { sub: 1, name: "Test", email: "test@x.com", role: "System Admin", isSystem: true } }),
  requireAuth: async () => ({ user: { sub: 1, name: "Test", email: "test@x.com", role: "System Admin", isSystem: true } }),
  requireAdmin: async () => ({ user: { sub: 1, name: "Test", email: "test@x.com", role: "System Admin", isSystem: true } }),
  isAuthError: (r: unknown) => r instanceof Response,
}));


// eslint-disable-next-line @typescript-eslint/no-explicit-any
const insertValues = vi.fn((..._args: any[]) => ({ returning: async () => [{ id: 99 }] }));
const transaction = vi.fn(async (cb: (tx: unknown) => Promise<void>) =>
  cb({ insert: () => ({ values: insertValues }) }),
);

const partnersTable = { __t: "partners" };
const clientPurchaseOrdersTable = { __t: "cpo" };
const clientEventsTable = { __t: "events" };
const partnerPurchaseOrdersTable = { __t: "ppo" };
const partnerPurchaseOrderItemsTable = { __t: "ppoItems" };

let data: Record<string, unknown[]> = {};

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: (t: { __t: string }) => data[t.__t] ?? [] }),
    transaction,
  },
  partnersTable, clientPurchaseOrdersTable, clientEventsTable,
  partnerPurchaseOrdersTable, partnerPurchaseOrderItemsTable,
}));

vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(async () => ({ sub: 42, name: "T", email: "t@x.com", role: "Admin", isSystem: true })),
}));

function call(type: string, body: unknown) {
  return import("./route").then(({ POST }) =>
    POST(
      new Request(`http://localhost/api/import/${type}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ type }) },
    ),
  );
}

beforeEach(() => {
  insertValues.mockClear();
  transaction.mockClear();
  data = {
    partners: [{ id: 3, name: "Acme Media", codePrefix: "ACME" }],
    cpo: [{ id: 11, code: "CPO-ACME-0126-0001", clientId: 7 }],
    events: [{ id: 21, clientId: 7, name: "Install" }, { id: 22, clientId: 7, name: "Signup" }],
    ppo: [],
  };
});

// mapping: poReference, partnerName, clientPoCode, startDate, endDate, notes, eventName, cacRate, eventCount
const MAPPING = { poReference: 0, partnerName: 1, clientPoCode: 2, startDate: 3, endDate: 4, notes: 5, eventName: 6, cacRate: 7, eventCount: 8 };
const hdr = ["PO-1", "Acme Media", "CPO-ACME-0126-0001", "2026-01-10", "2026-02-10", ""];

describe("POST /api/import/partner-purchase-orders", () => {
  it("dry-run groups two item rows into one valid PO and does not write", async () => {
    const res = await call("partner-purchase-orders", {
      mapping: MAPPING,
      rows: [[...hdr, "Install", "2.5", "1000"], [...hdr, "Signup", "1", "500"]],
      dryRun: true,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.valid).toBe(1);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("commit inserts one partner PO (PPO- code) and its two items", async () => {
    const res = await call("partner-purchase-orders", {
      mapping: MAPPING,
      rows: [[...hdr, "Install", "2.5", "1000"], [...hdr, "Signup", "1", "500"]],
      dryRun: false,
    });
    expect(res.status).toBe(200);
    expect(transaction).toHaveBeenCalledTimes(1);
    // 1st insert = the PO, 2nd = the items array
    const poInsert = insertValues.mock.calls[0][0];
    expect(poInsert).toMatchObject({ partnerId: 3, clientPurchaseOrderId: 11, createdById: 42 });
    expect(poInsert.code).toMatch(/^PPO-ACME-\d{4}-0001$/);
    expect(String(poInsert.totalBudget)).toBe("3000"); // 2.5*1000 + 1*500
    const itemsInsert = insertValues.mock.calls[1][0];
    expect(itemsInsert).toHaveLength(2);
    expect(itemsInsert[0]).toMatchObject({ partnerPurchaseOrderId: 99, clientEventId: 21 });
  });
});