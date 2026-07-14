// app/lib/import/parse.test.ts
import { describe, it, expect } from "vitest";
import { parseDelimited } from "./parse";

describe("parseDelimited", () => {
  it("parses CSV into headers + data rows, trimming headers", () => {
    const { headers, rows } = parseDelimited("clientName, receiveDate\nAcme,2026-01-05\n");
    expect(headers).toEqual(["clientName", "receiveDate"]);
    expect(rows).toEqual([["Acme", "2026-01-05"]]);
  });

  it("auto-detects tab-delimited files", () => {
    const { headers, rows } = parseDelimited("clientName\treceiveDate\nAcme\t2026-01-05");
    expect(headers).toEqual(["clientName", "receiveDate"]);
    expect(rows).toEqual([["Acme", "2026-01-05"]]);
  });

  it("skips blank lines", () => {
    const { rows } = parseDelimited("a,b\n\nx,y\n\n");
    expect(rows).toEqual([["x", "y"]]);
  });

  it("returns empty structure for an empty file", () => {
    expect(parseDelimited("")).toEqual({ headers: [], rows: [] });
  });
});
