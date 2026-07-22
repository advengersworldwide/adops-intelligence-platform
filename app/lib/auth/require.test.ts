import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn() },
  rolesTable: {},
}));
vi.mock("./session");
vi.mock("@/lib/rbac/role-permissions");

import { requirePermission, isAuthError } from "./require";
import { getSession } from "./session";
import { getRolePermissions } from "@/lib/rbac/role-permissions";

const mockGetSession = vi.mocked(getSession);
const mockGetRolePermissions = vi.mocked(getRolePermissions);

beforeEach(() => {
  mockGetSession.mockReset();
  mockGetRolePermissions.mockReset();
});

describe("requirePermission", () => {
  it("401 when unauthenticated", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const res = await requirePermission("clients:view");
    expect(isAuthError(res)).toBe(true);
    if (isAuthError(res)) expect(res.status).toBe(401);
  });

  it("403 when the role lacks the permission", async () => {
    mockGetSession.mockResolvedValueOnce({ sub: 2, name: "V", email: "v@x.com", role: "Viewer", isSystem: false });
    mockGetRolePermissions.mockResolvedValueOnce(["clients:view"]);
    const res = await requirePermission("clients:edit");
    expect(isAuthError(res)).toBe(true);
    if (isAuthError(res)) expect(res.status).toBe(403);
  });

  it("passes for a granted permission", async () => {
    mockGetSession.mockResolvedValueOnce({ sub: 2, name: "V", email: "v@x.com", role: "Viewer", isSystem: false });
    mockGetRolePermissions.mockResolvedValueOnce(["clients:view"]);
    const res = await requirePermission("clients:view");
    expect(isAuthError(res)).toBe(false);
  });

  it("passes for a system admin regardless of role perms", async () => {
    mockGetSession.mockResolvedValueOnce({ sub: 1, name: "A", email: "a@x.com", role: "System Admin", isSystem: true });
    mockGetRolePermissions.mockResolvedValueOnce([]);
    const res = await requirePermission("settings.roles:manage");
    expect(isAuthError(res)).toBe(false);
  });
});
