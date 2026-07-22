// app/app/api/import/[type]/route.test.ts
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

// Table sentinels so loadContext can tell which select is which.
const clientsTable = { __t: "clients" };
const clientPurchaseOrdersTable = { __t: "cpo" };

let clientRows: unknown[] = [];
let cpoRows: unknown[] = [];

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: (t: { __t: string }) => (t.__t === "clients" ? clientRows : cpoRows),
    }),
    transaction,
  },
  clientsTable,
  clientPurchaseOrdersTable,
}));

vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(async () => ({ sub: 42, name: "Tester", email: "t@x.com", role: "Admin", isSystem: true })),
}));

function call(type: string, body: unknown) {
  return import("./route").then(({ POST }) =>
    POST(
      new Request(`http://localhost/api/import/${type}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ type }) },
    ),
  );
}

beforeEach(() => {
  insertValues.mockClear();
  transaction.mockClear();
  clientRows = [{ id: 7, name: "Acme", codePrefix: "ACME" }];
  cpoRows = [];
});

describe("POST /api/import/{type}", () => {
  it("returns 400 for an unknown import type", async () => {
    const res = await call("nonsense", { mapping: {}, rows: [["x"]], dryRun: true });
    expect(res.status).toBe(400);
  });

  it("dry-run returns per-row statuses and does not write", async () => {
    const res = await call("client-purchase-orders", {
      mapping: { clientName: 0, receiveDate: 1 },
      rows: [["Acme", "2026-01-05"], ["Ghost", "2026-01-05"]],
      dryRun: true,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(1);
    expect(body.errored).toBe(1);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("commit inserts valid rows", async () => {
    const res = await call("client-purchase-orders", {
      mapping: { clientName: 0, receiveDate: 1 },
      rows: [["Acme", "2026-01-05"]],
      dryRun: false,
    });
    expect(res.status).toBe(200);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledTimes(1);
    const inserted = insertValues.mock.calls[0][0];
    expect(inserted).toMatchObject({ clientId: 7, attachmentUrl: "", createdById: 42 });
    expect(inserted.code).toMatch(/^CPO-ACME-\d{4}-0001$/);
  });
});
