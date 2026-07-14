// app/lib/import/types.ts

/** One logical column an importer expects in the uploaded file. */
export interface ColumnSpec {
  key: string;        // canonical field name, e.g. "clientName"
  label: string;      // template header + mapping UI label
  required: boolean;
  aliases: string[];  // additional header spellings for auto-mapping
  example: string;    // sample value used to build the downloadable template
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

/**
 * A descriptor teaches the engine how to import one data type.
 * TCtx is batch-loaded lookup state; TPayload is a resolved insert record.
 */
export interface ImportDescriptor<TCtx, TPayload> {
  type: string;   // URL segment, e.g. "client-purchase-orders"
  label: string;  // shown in the type picker
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
