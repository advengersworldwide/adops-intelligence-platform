import { describe, it, expect, vi, beforeEach } from "vitest";

const requireAuth = vi.fn();
vi.mock("@/lib/auth/require", () => ({
  requireAuth: () => requireAuth(),
  isAuthError: (r: unknown) => r instanceof Response,
}));

const rows: Record<number, unknown> = {};
vi.mock("@workspace/db", () => ({ db: {}, dashboardLayoutsTable: {} }));
vi.mock("@/lib/dashboard/layout-store", () => ({
  getLayout: (userId: number) => Promise.resolve(rows[userId] ?? null),
  upsertLayout: (userId: number, body: unknown) => { rows[userId] = body; return Promise.resolve({ userId, ...(body as object) }); },
}));

import { GET, PUT } from "./route";

beforeEach(() => { for (const k of Object.keys(rows)) delete rows[Number(k)]; requireAuth.mockReset(); });

describe("me/dashboard-layout", () => {
  it("GET returns null when the user has no saved row", async () => {
    requireAuth.mockResolvedValue({ user: { sub: 7 } });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });
  it("PUT upserts for the session user and GET reads it back", async () => {
    requireAuth.mockResolvedValue({ user: { sub: 7 } });
    const body = { activeWidgets: ["revenue-kpi"], layout: [{ i: "revenue-kpi", x: 0, y: 0, w: 3, h: 3 }], preset: "exec" };
    const putRes = await PUT(new Request("http://x", { method: "PUT", body: JSON.stringify(body) }));
    expect(putRes.status).toBe(200);
    const getRes = await GET();
    expect(await getRes.json()).toMatchObject({ activeWidgets: ["revenue-kpi"], preset: "exec" });
  });
  it("GET returns 401 when unauthenticated", async () => {
    requireAuth.mockResolvedValue(new Response(null, { status: 401 }));
    const res = await GET();
    expect(res.status).toBe(401);
  });
  it("PUT rejects a malformed body with 400", async () => {
    requireAuth.mockResolvedValue({ user: { sub: 7 } });
    const res = await PUT(new Request("http://x", { method: "PUT", body: JSON.stringify({ activeWidgets: "nope" }) }));
    expect(res.status).toBe(400);
  });
});