// app/lib/import/parse.ts
import Papa from "papaparse";

export interface ParsedFile {
  headers: string[];
  rows: string[][];
}

/** Parse CSV or TSV text. Delimiter is auto-detected; blank lines are dropped. */
export function parseDelimited(text: string): ParsedFile {
  const result = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
  const data = result.data;
  if (data.length === 0) return { headers: [], rows: [] };
  const [headerRow, ...rows] = data;
  return { headers: headerRow.map((h) => h.trim()), rows };
}
