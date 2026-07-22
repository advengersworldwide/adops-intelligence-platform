import { describe, it, expect, vi, beforeEach } from "vitest";

// RBAC: routes now enforce permissions; bypass the guard in unit tests.
vi.mock("@/lib/auth/require", () => ({
  requirePermission: async () => ({ user: { sub: 1, name: "Test", email: "test@x.com", role: "System Admin", isSystem: true } }),
  requireAuth: async () => ({ user: { sub: 1, name: "Test", email: "test@x.com", role: "System Admin", isSystem: true } }),
  requireAdmin: async () => ({ user: { sub: 1, name: "Test", email: "test@x.com", role: "System Admin", isSystem: true } }),
  isAuthError: (r: unknown) => r instanceof Response,
}));


const selectChain = vi.fn();
const insertReturning = vi.fn();
const insertItems = vi.fn(async () => undefined);

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => selectChain(), orderBy: () => selectChain() }) }),
    insert: (t: unknown) => ({
      values: (v: unknown) => ({
        returning: () => insertReturning(),
      }),
    }),
  },
  partnerPurchaseOrdersTable: {}, partnerPurchaseOrderItemsTable: {}, partnersTable: {},
  clientPurchaseOrdersTable: {}, clientsTable: {}, buyingHousesTable: {}, usersTable: {},
}));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn(async () => ({ sub: 7, name: "Tester" })) }));

beforeEach(() => { selectChain.mockReset(); insertReturning.mockReset(); });

async function post(body: unknown) {
  const { POST } = await import("./route");
  return POST(new Request("http://localhost/api/partner-purchase-orders", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
}

describe("POST /api/partner-purchase-orders", () => {
  it("400 when items are missing", async () => {
    const res = await post({ partnerId: 1, clientPurchaseOrderId: 1, startDate: "2026-06-01", endDate: "2026-06-30" });
    expect(res.status).toBe(400);
  });
});
