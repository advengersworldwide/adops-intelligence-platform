import { describe, it, expect } from "vitest";
import { can, isSuperAdmin, effectivePermissions } from "./can";
import { ALL_PERMISSIONS } from "./catalog";

describe("can / effectivePermissions", () => {
  it("membership check", () => {
    const set = new Set(["clients:view"]);
    expect(can(set, "clients:view")).toBe(true);
    expect(can(set, "clients:edit")).toBe(false);
  });

  it("isSuperAdmin true for isSystem or System Admin role", () => {
    expect(isSuperAdmin({ role: "Viewer", isSystem: true })).toBe(true);
    expect(isSuperAdmin({ role: "System Admin", isSystem: false })).toBe(true);
    expect(isSuperAdmin({ role: "Viewer", isSystem: false })).toBe(false);
  });

  it("super admin gets the full catalog", () => {
    const eff = effectivePermissions({ role: "System Admin", isSystem: false }, []);
    expect(eff.size).toBe(ALL_PERMISSIONS.length);
    expect(eff.has("settings.roles:manage")).toBe(true);
  });

  it("non-admin gets exactly their role permissions", () => {
    const eff = effectivePermissions({ role: "Viewer", isSystem: false }, ["clients:view"]);
    expect([...eff]).toEqual(["clients:view"]);
  });
});