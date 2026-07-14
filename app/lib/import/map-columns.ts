// app/lib/import/map-columns.ts
import type { ColumnSpec } from "./types";

export function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Best-effort map of descriptor column key -> 0-based header index. */
export function autoMapColumns(headers: string[], columns: ColumnSpec[]): Record<string, number> {
  const normalized = headers.map(normalizeHeader);
  const mapping: Record<string, number> = {};
  for (const col of columns) {
    const candidates = new Set([col.key, col.label, ...col.aliases].map(normalizeHeader));
    const idx = normalized.findIndex((h) => candidates.has(h));
    if (idx !== -1) mapping[col.key] = idx;
  }
  return mapping;
}
