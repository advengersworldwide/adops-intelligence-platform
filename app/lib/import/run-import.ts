// app/lib/import/run-import.ts
import type { EngineResult, ImportDescriptor, ImportSession, RowResult } from "./types";

export interface RunOptions {
  dryRun: boolean;
  session: ImportSession;
}

const MAX_ROWS = 5000;

export async function runImport<TCtx, TPayload>(
  descriptor: ImportDescriptor<TCtx, TPayload>,
  rows: string[][],
  mapping: Record<string, number>,
  opts: RunOptions,
): Promise<EngineResult> {
  const empty: EngineResult = { total: 0, valid: 0, skipped: 0, errored: 0, fileErrors: [], rows: [] };

  if (rows.length === 0) {
    return { ...empty, fileErrors: ["File has no data rows"] };
  }
  if (rows.length > MAX_ROWS) {
    return { ...empty, fileErrors: [`Too many rows (${rows.length}). Split into files of at most ${MAX_ROWS} rows.`] };
  }
  const missing = descriptor.columns
    .filter((c) => c.required && mapping[c.key] == null)
    .map((c) => c.label);
  if (missing.length) {
    return { ...empty, fileErrors: [`Missing required column(s): ${missing.join(", ")}`] };
  }

  const cellsOf = (row: string[]): Record<string, string> => {
    const cells: Record<string, string> = {};
    for (const col of descriptor.columns) {
      const idx = mapping[col.key];
      cells[col.key] = idx == null ? "" : (row[idx] ?? "").trim();
    }
    return cells;
  };

  const ctx = await descriptor.loadContext();
  const seen = new Set<string>();
  const results: RowResult<TPayload>[] = [];

  if ("groupBy" in descriptor) {
    const groupLabel = descriptor.columns.find((c) => c.key === descriptor.groupBy)?.label ?? descriptor.groupBy;
    const groups = new Map<string, Array<{ cells: Record<string, string>; rowNumber: number }>>();
    for (let i = 0; i < rows.length; i++) {
      const cells = cellsOf(rows[i]);
      const key = cells[descriptor.groupBy];
      if (!key) {
        results.push({ rowNumber: i + 1, status: "error", messages: [`${groupLabel} is required`] });
        continue;
      }
      const list = groups.get(key) ?? [];
      list.push({ cells, rowNumber: i + 1 });
      groups.set(key, list);
    }
    for (const groupRows of groups.values()) {
      results.push(descriptor.resolveGroup(groupRows, ctx, seen));
    }
  } else {
    for (let i = 0; i < rows.length; i++) {
      results.push(descriptor.resolveRow(cellsOf(rows[i]), i + 1, ctx, seen));
    }
  }

  const validPayloads = results.filter((r) => r.status === "valid").map((r) => r.payload as TPayload);
  if (!opts.dryRun && validPayloads.length > 0) {
    await descriptor.commit(validPayloads, ctx, opts.session);
  }

  return {
    total: results.length,
    valid: results.filter((r) => r.status === "valid").length,
    skipped: results.filter((r) => r.status === "skip").length,
    errored: results.filter((r) => r.status === "error").length,
    fileErrors: [],
    rows: results.map((r) => ({ rowNumber: r.rowNumber, status: r.status, messages: r.messages })),
  };
}
