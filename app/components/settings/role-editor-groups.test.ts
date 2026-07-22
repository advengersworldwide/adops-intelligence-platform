import { describe, it, expect } from "vitest";
import { groupPermissions } from "./RolePermissionEditor";

describe("groupPermissions", () => {
  it("groups catalog entries by their group label", () => {
    const groups = groupPermissions();
    const names = groups.map((g) => g.group);
    expect(names).toContain("Clients");
    expect(names).toContain("Settings");
  });
  it("Clients group contains view/edit/delete + tabs + fields", () => {
    const groups = groupPermissions();
    const clients = groups.find((g) => g.group === "Clients")!;
    const keys = clients.items.map((i) => i.key);
    expect(keys).toEqual(expect.arrayContaining([
      "clients:view", "clients:edit", "clients:delete",
      "clients.data:view", "clients.bank:view",
    ]));
  });
});
