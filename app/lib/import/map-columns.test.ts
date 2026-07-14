// app/lib/import/map-columns.test.ts
import { describe, it, expect } from "vitest";
import { normalizeHeader, autoMapColumns } from "./map-columns";
import type { ColumnSpec } from "./types";

const columns: ColumnSpec[] = [
  { key: "clientName", label: "Client Name", required: true, aliases: ["client"], example: "Acme" },
  { key: "receiveDate", label: "Receive Date", required: false, aliases: ["received"], example: "2026-01-05" },
];

describe("normalizeHeader", () => {
  it("lowercases and strips non-alphanumerics", () => {
    expect(normalizeHeader("  Client Name! ")).toBe("clientname");
  });
});

describe("autoMapColumns", () => {
  it("maps by key, label, or alias regardless of spacing/case", () => {
    const map = autoMapColumns(["Client", "RECEIVE DATE"], columns);
    expect(map).toEqual({ clientName: 0, receiveDate: 1 });
  });

  it("omits columns with no matching header", () => {
    const map = autoMapColumns(["something"], columns);
    expect(map).toEqual({});
  });
});
