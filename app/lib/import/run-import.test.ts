// app/lib/import/run-import.test.ts
import { describe, it, expect, vi } from "vitest";
import { runImport } from "./run-import";
import type { ImportDescriptor, RowResult } from "./types";
import type { GroupedImportDescriptor } from "./types";

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

// A fake grouped descriptor: groups rows by "ref"; one item column "v".
function fakeGrouped(commitSpy: (groups: number) => void): GroupedImportDescriptor<{ ok: true }, { ref: string; items: string[] }> {
  return {
    type: "fake-grouped",
    label: "Fake Grouped",
    groupBy: "ref",
    columns: [
      { key: "ref", label: "Ref", required: true, aliases: [], example: "A" },
      { key: "v", label: "V", required: true, aliases: [], example: "x" },
    ],
    async loadContext() { return { ok: true }; },
    resolveGroup(groupRows) {
      const ref = groupRows[0].cells.ref;
      if (ref === "bad") return { rowNumber: groupRows[0].rowNumber, status: "error", messages: ["bad group"] };
      return { rowNumber: groupRows[0].rowNumber, status: "valid", messages: [], payload: { ref, items: groupRows.map((r) => r.cells.v) } };
    },
    async commit(payloads) { commitSpy(payloads.length); },
  };
}

describe("runImport (grouped)", () => {
  it("groups rows by the groupBy column and resolves one result per group", async () => {
    const res = await runImport(
      fakeGrouped(() => {}),
      [["A", "x"], ["A", "y"], ["B", "z"]],
      { ref: 0, v: 1 },
      { dryRun: true, session: { userId: null } },
    );
    expect(res.total).toBe(2);
    expect(res.valid).toBe(2);
  });

  it("flags rows with an empty group key as errors", async () => {
    const res = await runImport(
      fakeGrouped(() => {}),
      [["", "x"], ["A", "y"]],
      { ref: 0, v: 1 },
      { dryRun: true, session: { userId: null } },
    );
    expect(res.errored).toBe(1);
    expect(res.valid).toBe(1);
    expect(res.rows.find((r) => r.status === "error")?.messages[0]).toContain("Ref");
  });

  it("commit passes one payload per valid group", async () => {
    const spy = vi.fn();
    await runImport(
      fakeGrouped(spy),
      [["A", "x"], ["A", "y"], ["bad", "z"]],
      { ref: 0, v: 1 },
      { dryRun: false, session: { userId: 1 } },
    );
    expect(spy).toHaveBeenCalledWith(1);
  });
});
