// app/lib/import/descriptors/cpo-helpers.ts
import { parsePoCode, seedMaxSeq as seedMaxSeqTagged } from "../po-code-seq";

export function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/** Build a local Date from a "YYYY-MM-DD" string without timezone drift. */
export function isoToLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Validate a date cell. Empty -> null. Invalid -> null + labelled error pushed. */
export function parseDateCell(value: string, label: string, errors: string[]): string | null {
  const v = value.trim();
  if (!v) return null;
  if (!ISO_DATE.test(v)) {
    errors.push(`${label} must be in YYYY-MM-DD format (got "${v}")`);
    return null;
  }
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
    errors.push(`${label} is not a real date (got "${v}")`);
    return null;
  }
  return v;
}

export function dedupKey(
  clientId: number,
  receiveDate: string | null,
  startDate: string | null,
  endDate: string | null,
): string {
  return `${clientId}|${receiveDate ?? ""}|${startDate ?? ""}|${endDate ?? ""}`;
}

/** MMYY string matching formatPoCode's month+2-digit-year segment. */
export function mmyyKey(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yy = String(date.getFullYear() % 100).padStart(2, "0");
  return `${mm}${yy}`;
}

/** Parse a "CPO-<prefix>-<mmyy>-<seq>" code. Delegates to the shared tagged parser. */
export function parseCpoCode(code: string): { prefix: string; mmyy: string; seq: number } | null {
  const p = parsePoCode(code);
  if (!p || p.tag !== "CPO") return null;
  return { prefix: p.prefix, mmyy: p.mmyy, seq: p.seq };
}

/** Build a map of `${prefix}|${mmyy}` -> highest existing sequence number (CPO codes). */
export function seedMaxSeq(codes: string[]): Map<string, number> {
  return seedMaxSeqTagged(codes, "CPO");
}
