// app/lib/import/run-import.test.ts
import { describe, it, expect, vi } from "vitest";
import { runImport } from "./run-import";
import type { ImportDescriptor, RowResult } from "./types";

// A tiny fake descriptor: valid unless the cell equals "bad".
function fakeDescriptor(commitSpy: (n: number) => void): ImportDescriptor<{ ok: true }, { v: string }> {
  return {
    type: "fake",
    label: "Fake",
    columns: [{ key: "v", label: "V", required: true, aliases: [], example: "x" }],
    async loadContext() { return { ok: true }; },
    resolveRow(cells, rowNumber): RowResult<{ v: string }> {
      if (cells.v === "bad") return { rowNumber, status: "error", messages: ["bad value"] };
      return { rowNumber, status: "valid", messages: [], payload: { v: cells.v } };
    },
    async commit(payloads) { commitSpy(payloads.length); },
  };
}

describe("runImport", () => {
  it("reports a file error when a required column is unmapped", async () => {
    const res = await runImport(fakeDescriptor(() => {}), [["x"]], {}, { dryRun: true, session: { userId: null } });
    expect(res.fileErrors[0]).toContain("V");
    expect(res.rows).toEqual([]);
  });

  it("dry-run annotates rows and never commits", async () => {
    const spy = vi.fn();
    const res = await runImport(fakeDescriptor(spy), [["good"], ["bad"]], { v: 0 }, { dryRun: true, session: { userId: null } });
    expect(res.total).toBe(2);
    expect(res.valid).toBe(1);
    expect(res.errored).toBe(1);
    expect(spy).not.toHaveBeenCalled();
  });

  it("commit inserts only the valid payloads", async () => {
    const spy = vi.fn();
    const res = await runImport(fakeDescriptor(spy), [["good"], ["bad"], ["good2"]], { v: 0 }, { dryRun: false, session: { userId: 1 } });
    expect(res.valid).toBe(2);
    expect(spy).toHaveBeenCalledWith(2);
  });
});
