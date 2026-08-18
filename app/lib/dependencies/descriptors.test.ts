import { describe, it, expect } from "vitest";
import { allTableNames } from "../../../lib/db/src/dependency-graph";
import { DESCRIPTORS, getDescriptor, hasDescriptor } from "./descriptors";

describe("descriptor registry", () => {
  it("has an entry for every table in the schema", () => {
    const missing = allTableNames.filter(t => !hasDescriptor(t));
    expect(missing).toEqual([]);
  });

  it("has no entries for tables that no longer exist", () => {
    const orphans = Object.keys(DESCRIPTORS).filter(t => !allTableNames.includes(t));
    expect(orphans).toEqual([]);
  });

  it("records the permission each existing route actually requires", () => {
    expect(getDescriptor("clients").deletePermission).toBe("clients:delete");
    expect(getDescriptor("payments").deletePermission).toBe("payments:edit");
    expect(getDescriptor("billings").deletePermission).toBe("billings:edit");
    expect(getDescriptor("cost_models").deletePermission).toBe("settings.catalogs:manage");
    expect(getDescriptor("tax_settings").deletePermission).toBe("settings.general:view");
  });

  it("marks financial tables so they trigger typed confirmation", () => {
    expect(getDescriptor("billings").financial).toBe(true);
    expect(getDescriptor("payments").financial).toBe(true);
    expect(getDescriptor("partner_bills").financial).toBe(true);
    expect(getDescriptor("clients").financial).toBe(false);
  });

  it("builds a human label from a row", () => {
    expect(getDescriptor("clients").labelWith({ id: 3, name: "Acme" })).toBe("Acme");
    expect(getDescriptor("billings").labelWith({ id: 12, invoiceCode: "CBILL-0012" })).toBe("CBILL-0012");
    expect(getDescriptor("billings").labelWith({ id: 12, invoiceCode: null })).toBe("Billing #12");
  });

  it("always includes id in labelColumns so the resolver selects it", () => {
    for (const t of allTableNames) {
      expect(getDescriptor(t).labelColumns).toContain("id");
    }
  });

  it("throws on an unknown table", () => {
    expect(() => getDescriptor("not_a_table")).toThrow();
  });
});
