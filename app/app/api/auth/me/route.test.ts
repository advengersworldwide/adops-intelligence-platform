import { describe, it, expect, vi, beforeEach } from "vitest";

const selectRow = vi.fn();

vi.mock("@workspace/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => selectRow() }) }) },
  usersTable: { id: "id" },
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
  selectRow.mockReset();
});

describe("GET /api/auth/me", () => {
  it("401 when unauthenticated", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("401 when the token version has been revoked", async () => {
    mockGetSession.mockResolvedValueOnce({ sub: 2, name: "V", username: "v", email: "v@x.com", role: "Viewer", isSystem: false, tokenVersion: 1 });
    selectRow.mockReturnValueOnce([{ id: 2, username: "v", tokenVersion: 0, twoFactorEnabledAt: null }]);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns the role's permission set for a normal user", async () => {
    mockGetSession.mockResolvedValueOnce({ sub: 2, name: "V", username: "v", email: "v@x.com", role: "Viewer", isSystem: false, tokenVersion: 0 });
    selectRow.mockReturnValueOnce([{ id: 2, username: "v", tokenVersion: 0, twoFactorEnabledAt: null }]);
    mockGetRolePermissions.mockResolvedValueOnce(["clients:view"]);
    mockEffectivePermissions.mockReturnValueOnce(new Set(["clients:view"]));
    const res = await GET();
    const body = await res.json();
    expect(body.permissions).toEqual(["clients:view"]);
    expect(body.username).toBe("v");
    expect(body.twoFactorEnabled).toBe(false);
  });

  it("returns the full catalog for a system admin, including 2FA state", async () => {
    mockGetSession.mockResolvedValueOnce({ sub: 1, name: "A", username: "admin", email: "a@x.com", role: "System Admin", isSystem: true, tokenVersion: 0 });
    selectRow.mockReturnValueOnce([{ id: 1, username: "admin", tokenVersion: 0, twoFactorEnabledAt: new Date() }]);
    mockGetRolePermissions.mockResolvedValueOnce([]);
    mockEffectivePermissions.mockReturnValueOnce(new Set(["settings.roles:manage"]));
    const res = await GET();
    const body = await res.json();
    expect(body.permissions).toContain("settings.roles:manage");
    expect(body.twoFactorEnabled).toBe(true);
  });
});