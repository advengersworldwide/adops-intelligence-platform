// app/app/api/import/[type]/partner-bills-route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// RBAC: routes now enforce permissions; bypass the guard in unit tests.
vi.mock("@/lib/auth/require", () => ({
  requirePermission: async () => ({ user: { sub: 1, name: "Test", email: "test@x.com", role: "System Admin", isSystem: true } }),
  requireAuth: async () => ({ user: { sub: 1, name: "Test", email: "test@x.com", role: "System Admin", isSystem: true } }),
  requireAdmin: async () => ({ user: { sub: 1, name: "Test", email: "test@x.com", role: "System Admin", isSystem: true } }),
  isAuthError: (r: unknown) => r instanceof Response,
}));


const insertValues = vi.fn();
const transaction = vi.fn(async (cb: (tx: unknown) => Promise<void>) =>
  cb({ insert: () => ({ values: insertValues }) }),
);

const partnersTable = { __t: "partners" };
const clientsTable = { __t: "clients" };
const partnerPurchaseOrdersTable = { __t: "ppo" };
const partnerBillsTable = { __t: "pbill" };

let data: Record<string, unknown[]> = {};

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: (t: { __t: string }) => data[t.__t] ?? [] }),
    transaction,
  },
  partnersTable, clientsTable, partnerPurchaseOrdersTable, partnerBillsTable,
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
    clients: [],
    ppo: [],
    pbill: [],
  };
});

// mapping: partnerName, amount, partnerInvoiceNumber, clientName, partnerPoCode, dateReceived, notes
const MAPPING = { partnerName: 0, amount: 1, partnerInvoiceNumber: 2, clientName: 3, partnerPoCode: 4, dateReceived: 5, notes: 6 };

describe("POST /api/import/partner-bills", () => {
  it("dry-run reports one valid row and does not write", async () => {
    const res = await call("partner-bills", {
      mapping: MAPPING,
      rows: [["Acme Media", "1500.00", "INV-9", "", "", "2026-01-20", ""]],
      dryRun: true,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(1);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("commit inserts a partner bill with a PBILL- code and stored amount", async () => {
    const res = await call("partner-bills", {
      mapping: MAPPING,
      rows: [["Acme Media", "1500.50", "INV-9", "", "", "2026-01-20", "Jan"]],
      dryRun: false,
    });
    expect(res.status).toBe(200);
    expect(transaction).toHaveBeenCalledTimes(1);
    const inserted = insertValues.mock.calls[0][0];
    expect(inserted).toMatchObject({ partnerId: 3, amount: "1500.5", createdById: 42, attachmentUrl: null });
    expect(inserted.code).toMatch(/^PBILL-ACME-\d{4}-0001$/);
  });
});
