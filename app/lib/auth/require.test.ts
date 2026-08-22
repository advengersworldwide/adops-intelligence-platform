import { describe, it, expect, vi, beforeEach } from "vitest";

const selectMock = vi.fn();
vi.mock("@workspace/db", () => ({
  db: { select: () => ({ from: () => ({ where: selectMock }) }) },
  usersTable: { id: "id", tokenVersion: "tokenVersion" },
}));
vi.mock("./session");
vi.mock("@/lib/rbac/role-permissions");

import { requireAuth, requireAdmin, requirePermission, isAuthError } from "./require";
import { getSession } from "./session";
import { getRolePermissions } from "@/lib/rbac/role-permissions";
import type { SessionUser } from "./jwt";

const mockGetSession = vi.mocked(getSession);
const mockGetRolePermissions = vi.mocked(getRolePermissions);

/** Queues the session the next getSession() call resolves to. */
function mockSession(user: SessionUser) {
  mockGetSession.mockResolvedValueOnce(user);
}

/** Queues the row the next users-table tokenVersion lookup resolves to. `null` means no row. */
function mockDbUserRow(row: { tokenVersion: number } | null) {
  selectMock.mockResolvedValueOnce(row ? [row] : []);
}

beforeEach(() => {
  mockGetSession.mockReset();
  mockGetRolePermissions.mockReset();
  selectMock.mockReset();
});

describe("requirePermission", () => {
  it("401 when unauthenticated", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const res = await requirePermission("clients:view");
    expect(isAuthError(res)).toBe(true);
    if (isAuthError(res)) expect(res.status).toBe(401);
  });

  it("403 when the role lacks the permission", async () => {
    mockSession({ sub: 2, name: "V", username: "v", email: "v@x.com", role: "Viewer", isSystem: false, tokenVersion: 0 });
    mockDbUserRow({ tokenVersion: 0 });
    mockGetRolePermissions.mockResolvedValueOnce(["clients:view"]);
    const res = await requirePermission("clients:edit");
    expect(isAuthError(res)).toBe(true);
    if (isAuthError(res)) expect(res.status).toBe(403);
  });

  it("passes for a granted permission", async () => {
    mockSession({ sub: 2, name: "V", username: "v", email: "v@x.com", role: "Viewer", isSystem: false, tokenVersion: 0 });
    mockDbUserRow({ tokenVersion: 0 });
    mockGetRolePermissions.mockResolvedValueOnce(["clients:view"]);
    const res = await requirePermission("clients:view");
    expect(isAuthError(res)).toBe(false);
  });

  it("passes for a system admin regardless of role perms", async () => {
    mockSession({ sub: 1, name: "A", username: "admin", email: "a@x.com", role: "System Admin", isSystem: true, tokenVersion: 0 });
    mockDbUserRow({ tokenVersion: 0 });
    mockGetRolePermissions.mockResolvedValueOnce([]);
    const res = await requirePermission("settings.roles:manage");
    expect(isAuthError(res)).toBe(false);
  });

  it("rejects when the session's tokenVersion is stale", async () => {
    mockSession({ sub: 2, name: "V", username: "v", email: "v@x.com", role: "Viewer", isSystem: false, tokenVersion: 1 });
    mockDbUserRow({ tokenVersion: 2 });
    const res = await requirePermission("clients:view");
    expect(isAuthError(res)).toBe(true);
    if (isAuthError(res)) expect(res.status).toBe(401);
    expect(mockGetRolePermissions).not.toHaveBeenCalled();
  });
});

describe("requireAdmin", () => {
  it("passes for a system admin with a current tokenVersion", async () => {
    mockSession({ sub: 1, name: "A", username: "admin", email: "a@x.com", role: "System Admin", isSystem: true, tokenVersion: 0 });
    mockDbUserRow({ tokenVersion: 0 });
    const res = await requireAdmin();
    expect(isAuthError(res)).toBe(false);
  });

  it("rejects when the session's tokenVersion is stale", async () => {
    mockSession({ sub: 1, name: "A", username: "admin", email: "a@x.com", role: "System Admin", isSystem: true, tokenVersion: 1 });
    mockDbUserRow({ tokenVersion: 2 });
    const res = await requireAdmin();
    expect(isAuthError(res)).toBe(true);
    if (isAuthError(res)) expect(res.status).toBe(401);
  });
});

describe("token version enforcement", () => {
  it("rejects a session whose tokenVersion is stale", async () => {
    mockSession({ sub: 1, name: "A", username: "a", email: "a@x.com", role: "System Admin", isSystem: true, tokenVersion: 1 });
    mockDbUserRow({ tokenVersion: 2 }); // password was changed since this token was issued
    const result = await requireAuth();
    expect(isAuthError(result)).toBe(true);
    expect((result as Response).status).toBe(401);
  });

  it("accepts a session whose tokenVersion matches", async () => {
    mockSession({ sub: 1, name: "A", username: "a", email: "a@x.com", role: "System Admin", isSystem: true, tokenVersion: 2 });
    mockDbUserRow({ tokenVersion: 2 });
    const result = await requireAuth();
    expect(isAuthError(result)).toBe(false);
  });

  it("rejects when the user row no longer exists", async () => {
    mockSession({ sub: 99, name: "A", username: "a", email: "a@x.com", role: "Viewer", isSystem: false, tokenVersion: 0 });
    mockDbUserRow(null);
    expect(isAuthError(await requireAuth())).toBe(true);
  });
});
