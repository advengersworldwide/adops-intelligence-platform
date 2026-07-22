import { describe, it, expect } from "vitest";
import { PERMISSIONS, ALL_PERMISSIONS } from "./catalog";

describe("permission catalog", () => {
  it("has unique keys", () => {
    const keys = PERMISSIONS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("exposes ALL_PERMISSIONS matching PERMISSIONS keys", () => {
    expect(ALL_PERMISSIONS).toEqual(PERMISSIONS.map((p) => p.key));
  });

  it("every tab/field key has a parent module :view or nested parent", () => {
    const keys = new Set<string>(PERMISSIONS.map((p) => p.key));
    for (const p of PERMISSIONS) {
      if (p.kind !== "tab" && p.kind !== "field") continue;
      const [path] = p.key.split(":");
      const segments = path.split(".");
      const moduleView = `${segments[0]}:view`;
      expect(keys.has(moduleView), `${p.key} needs ${moduleView}`).toBe(true);
    }
  });

  it("includes the settings split and nested billing tabs", () => {
    const keys = new Set<string>(PERMISSIONS.map((p) => p.key));
    for (const k of [
      "settings.roles:manage", "settings.users:manage",
      "settings.catalogs:manage", "settings.general:view",
      "billings.client.summary:view", "billings.client.detail:view",
    ]) {
      expect(keys.has(k), `missing ${k}`).toBe(true);
    }
  });
});