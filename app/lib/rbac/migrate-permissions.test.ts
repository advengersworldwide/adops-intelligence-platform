import { describe, it, expect } from "vitest";
import { migratePermissions } from "./migrate-permissions";
import { ALL_PERMISSIONS } from "./catalog";

describe("migratePermissions", () => {
  it("expands View Clients into module + tabs + fields (no behavior loss)", () => {
    const out = migratePermissions(["View Clients"]);
    expect(out).toEqual(expect.arrayContaining([
      "clients:view", "clients.details:view", "clients.events:view",
      "clients.data:view", "clients.bank:view", "clients.tax:view",
    ]));
    expect(out).not.toContain("clients:delete"); // delete stays off
  });

  it("splits Manage Settings into settings:view + the four sub-perms", () => {
    const out = migratePermissions(["Manage Settings"]);
    expect(out).toEqual(expect.arrayContaining([
      "settings:view", "settings.general:view", "settings.roles:manage",
      "settings.users:manage", "settings.catalogs:manage",
    ]));
  });

  it("maps View Billing Detail to the nested client detail tab", () => {
    expect(migratePermissions(["View Billing Detail"])).toContain("billings.client.detail:view");
  });

  it("drops legacy View Transactions and produces only catalog keys", () => {
    const out = migratePermissions(["View Transactions", "View Clients"]);
    const valid = new Set(ALL_PERMISSIONS);
    for (const k of out) expect(valid.has(k as (typeof ALL_PERMISSIONS)[number])).toBe(true);
  });

  it("dedupes", () => {
    const out = migratePermissions(["View Clients", "View Clients"]);
    expect(new Set(out).size).toBe(out.length);
  });
});
