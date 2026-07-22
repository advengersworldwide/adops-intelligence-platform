import { describe, it, expect, vi, beforeEach } from "vitest";

const selectMock = vi.fn();
vi.mock("@workspace/db", () => ({
  db: { select: () => ({ from: () => ({ where: selectMock }) }) },
  rolesTable: { name: "name" },
}));

import { getRolePermissions, clearRolePermissionsCache } from "./role-permissions";

beforeEach(() => {
  clearRolePermissionsCache();
  selectMock.mockReset();
});

describe("getRolePermissions", () => {
  it("returns the role's permissions", async () => {
    selectMock.mockResolvedValueOnce([{ name: "Viewer", permissions: ["clients:view"] }]);
    expect(await getRolePermissions("Viewer")).toEqual(["clients:view"]);
  });

  it("caches within TTL (one DB read for two calls)", async () => {
    selectMock.mockResolvedValueOnce([{ name: "Viewer", permissions: ["clients:view"] }]);
    await getRolePermissions("Viewer");
    await getRolePermissions("Viewer");
    expect(selectMock).toHaveBeenCalledTimes(1);
  });

  it("returns [] for an unknown role", async () => {
    selectMock.mockResolvedValueOnce([]);
    expect(await getRolePermissions("Ghost")).toEqual([]);
  });
});