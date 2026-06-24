import { describe, it, expect, vi, beforeEach } from "vitest";

const insertReturning = vi.fn();
const selectChain = vi.fn();

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => selectChain(), orderBy: () => selectChain() }) }),
    insert: () => ({ values: () => ({ returning: () => insertReturning() }) }),
  },
  clientPurchaseOrdersTable: {}, clientsTable: {}, buyingHousesTable: {}, usersTable: {},
}));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn(async () => ({ sub: 7, name: "Tester" })) }));

beforeEach(() => { insertReturning.mockReset(); selectChain.mockReset(); });

async function post(body: unknown) {
  const { POST } = await import("./route");
  return POST(new Request("http://localhost/api/client-purchase-orders", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
}

describe("POST /api/client-purchase-orders", () => {
  it("returns 400 when clientId/attachmentUrl missing", async () => {
    const res = await post({ clientId: 1 });
    expect(res.status).toBe(400);
  });

  it("creates with a generated CPO code and 201", async () => {
    selectChain
      .mockResolvedValueOnce([{ value: 0 }])                // year count -> seq 1
      .mockResolvedValueOnce([{ name: "JazzCash", buyingHouseId: null }]) // mapCpoRow client
      .mockResolvedValueOnce([{ name: "Tester" }]);         // mapCpoRow user
    insertReturning.mockResolvedValueOnce([{
      id: 1, code: "CPO-2026-0001", clientId: 1, attachmentUrl: "http://x/f.pdf",
      attachmentName: "f.pdf", createdById: 7, createdAt: new Date("2026-06-24T00:00:00Z"),
    }]);
    const res = await post({ clientId: 1, attachmentUrl: "http://x/f.pdf", attachmentName: "f.pdf" });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.code).toBe("CPO-2026-0001");
    expect(json.clientName).toBe("JazzCash");
  });
});
