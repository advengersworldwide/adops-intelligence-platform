// app/app/api/import/[type]/partner-payments-route.test.ts
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

const partnerBillsTable = { __t: "pbill" };
const partnerPaymentsTable = { __t: "ppay" };

let data: Record<string, unknown[]> = {};

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: (t: { __t: string }) => data[t.__t] ?? [] }),
    transaction,
  },
  partnerBillsTable, partnerPaymentsTable,
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
    pbill: [{ id: 5, code: "PBILL-ACME-0126-0001", partnerId: 3, amount: "1500.00" }],
    ppay: [],
  };
});

// mapping: partnerBillCode, amount, status, mode, paymentDate, notes
const MAPPING = { partnerBillCode: 0, amount: 1, status: 2, mode: 3, paymentDate: 4, notes: 5 };

describe("POST /api/import/partner-payments", () => {
  it("dry-run reports one valid row and does not write", async () => {
    const res = await call("partner-payments", {
      mapping: MAPPING,
      rows: [["PBILL-ACME-0126-0001", "500.00", "settled", "wire", "2026-02-05", ""]],
      dryRun: true,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(1);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("commit inserts a payment with partnerId derived from the bill", async () => {
    const res = await call("partner-payments", {
      mapping: MAPPING,
      rows: [["PBILL-ACME-0126-0001", "500.00", "settled", "wire", "2026-02-05", "Jan"]],
      dryRun: false,
    });
    expect(res.status).toBe(200);
    expect(transaction).toHaveBeenCalledTimes(1);
    const inserted = insertValues.mock.calls[0][0];
    expect(inserted).toMatchObject({ partnerId: 3, partnerBillId: 5, amount: "500", status: "settled", sourceClientPaymentId: null, attachmentUrl: null, createdById: 42 });
  });

  it("errors the second row when two payments jointly exceed the bill remaining", async () => {
    const res = await call("partner-payments", {
      mapping: MAPPING,
      rows: [
        ["PBILL-ACME-0126-0001", "1000", "", "", "", ""],
        ["PBILL-ACME-0126-0001", "800", "", "", "", ""],
      ],
      dryRun: true,
    });
    const body = await res.json();
    expect(body.valid).toBe(1);
    expect(body.errored).toBe(1);
  });
});
