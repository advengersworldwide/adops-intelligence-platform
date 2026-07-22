import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn() },
  rolesTable: {},
}));
vi.mock("@/lib/auth/session");
vi.mock("@/lib/rbac/role-permissions");
vi.mock("@/lib/rbac/can");

import { GET } from "./route";
import { getSession } from "@/lib/auth/session";
import { getRolePermissions } from "@/lib/rbac/role-permissions";
import { effectivePermissions } from "@/lib/rbac/can";

const mockGetSession = vi.mocked(getSession);
const mockGetRolePermissions = vi.mocked(getRolePermissions);
const mockEffectivePermissions = vi.mocked(effectivePermissions);

beforeEach(() => {
  mockGetSession.mockReset();
  mockGetRolePermissions.mockReset();
  mockEffectivePermissions.mockReset();
});

describe("GET /api/auth/me", () => {
  it("401 when unauthenticated", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns the role's permission set for a normal user", async () => {
    mockGetSession.mockResolvedValueOnce({ sub: 2, name: "V", email: "v@x.com", role: "Viewer", isSystem: false });
    mockGetRolePermissions.mockResolvedValueOnce(["clients:view"]);
    mockEffectivePermissions.mockReturnValueOnce(new Set(["clients:view"]));
    const res = await GET();
    const body = await res.json();
    expect(body.permissions).toEqual(["clients:view"]);
  });

  it("returns the full catalog for a system admin", async () => {
    mockGetSession.mockResolvedValueOnce({ sub: 1, name: "A", email: "a@x.com", role: "System Admin", isSystem: true });
    mockGetRolePermissions.mockResolvedValueOnce([]);
    mockEffectivePermissions.mockReturnValueOnce(new Set(["settings.roles:manage"]));
    const res = await GET();
    const body = await res.json();
    expect(body.permissions).toContain("settings.roles:manage");
  });
});