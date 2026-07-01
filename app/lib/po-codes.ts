/** Build a purchase-order code: `PREFIX-MMYY-NNNN` (sequence zero-padded to >= 4). */
export function formatPoCode(prefix: string, date: Date, seq: number): string {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yy = String(date.getFullYear() % 100).padStart(2, "0");
  return `${prefix}-${mm}${yy}-${String(seq).padStart(4, "0")}`;
}

/** Suggested 4-char prefix from a name: first 4 alphanumerics, uppercased, X-padded. */
export function derivePrefix(name: string): string {
  const alnum = name.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return alnum.slice(0, 4).padEnd(4, "X");
}
