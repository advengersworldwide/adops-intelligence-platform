// app/lib/import/types.ts

/** One logical column an importer expects in the uploaded file. */
export interface ColumnSpec {
  key: string;        // canonical field name, e.g. "clientName"
  label: string;      // template header + mapping UI label
  required: boolean;
  aliases: string[];  // additional header spellings for auto-mapping
  example: string;    // sample value used in the downloadable sample CSV
  note?: string;      // one-line "what goes here", shown in the Expected-columns table
}

export type RowStatus = "valid" | "skip" | "error";

export interface RowResult<TPayload = unknown> {
  rowNumber: number;   // 1-based data-row index (header excluded)
  status: RowStatus;
  messages: string[];  // human-readable error / skip reasons
  payload?: TPayload;  // present only when status === "valid"
}

export interface EngineResult {
  total: number;
  valid: number;
  skipped: number;
  errored: number;
  fileErrors: string[]; // whole-file problems (missing required column, empty file)
  rows: Array<{ rowNumber: number; status: RowStatus; messages: string[] }>;
}

export interface ImportSession {
  userId: number | null;
}

/** A flat importer: one file row -> one record. */
export interface FlatImportDescriptor<TCtx, TPayload> {
  type: string;
  label: string;
  columns: ColumnSpec[];
  loadContext(): Promise<TCtx>;
  resolveRow(
    cells: Record<string, string>,
    rowNumber: number,
    ctx: TCtx,
    seen: Set<string>,
  ): RowResult<TPayload>;
  commit(payloads: TPayload[], ctx: TCtx, session: ImportSession): Promise<void>;
}

/** A grouped importer: rows sharing `groupBy`'s cell value -> one record (with children). */
export interface GroupedImportDescriptor<TCtx, TPayload> {
  type: string;
  label: string;
  columns: ColumnSpec[];
  groupBy: string;   // a required column key; rows are grouped by this cell's value
  loadContext(): Promise<TCtx>;
  resolveGroup(
    groupRows: Array<{ cells: Record<string, string>; rowNumber: number }>,
    ctx: TCtx,
    seen: Set<string>,
  ): RowResult<TPayload>;
  commit(payloads: TPayload[], ctx: TCtx, session: ImportSession): Promise<void>;
}

export type ImportDescriptor<TCtx, TPayload> =
  | FlatImportDescriptor<TCtx, TPayload>
  | GroupedImportDescriptor<TCtx, TPayload>;
