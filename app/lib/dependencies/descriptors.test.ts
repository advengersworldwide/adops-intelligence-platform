import { describe, it, expect } from "vitest";
import { allTableNames, columnsOf } from "../../../lib/db/src/dependency-graph";
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
    // Row shapes here must match what `db.execute` actually returns: keys are the
    // real snake_case DB column names, never Drizzle's camelCase TS properties.
    expect(getDescriptor("clients").labelWith({ id: 3, name: "Acme" })).toBe("Acme");
    expect(getDescriptor("billings").labelWith({ id: 12, invoice_code: "CBILL-0012" })).toBe("CBILL-0012");
    expect(getDescriptor("billings").labelWith({ id: 12, invoice_code: null })).toBe("Billing #12");
    expect(getDescriptor("payments").labelWith({ id: 7, reference_code: "CPMT-0825-0007" })).toBe("CPMT-0825-0007");
    expect(getDescriptor("partner_payments").labelWith({ id: 9, reference_code: "PPMT-0825-0009" })).toBe("PPMT-0825-0009");
  });

  it("always includes id in labelColumns so the resolver selects it", () => {
    for (const t of allTableNames) {
      expect(getDescriptor(t).labelColumns).toContain("id");
    }
  });

  // The resolver double-quotes every labelColumn through `sql.identifier()`, which
  // makes Postgres match it case-sensitively. A Drizzle TS property name like
  // "invoiceCode" therefore produces `column "invoiceCode" does not exist` and 500s
  // every delete for that table. Check the registry against the live schema.
  it("declares only real DB column names in labelColumns", () => {
    const bad: string[] = [];
    for (const [table, d] of Object.entries(DESCRIPTORS)) {
      const real = columnsOf.get(table);
      if (!real) continue; // covered by the "no entries for tables that no longer exist" test
      for (const c of d.labelColumns) {
        if (!real.includes(c)) bad.push(`${table}.${c}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("throws on an unknown table", () => {
    expect(() => getDescriptor("not_a_table")).toThrow();
  });
});
