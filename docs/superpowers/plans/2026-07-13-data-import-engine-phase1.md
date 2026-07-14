# Data Import Engine — Phase 1 (Client Purchase Orders) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable, config-driven bulk-import pipeline and ship the Client Purchase Order importer on it, replacing the dead legacy `/upload` (campaigns/transactions) flow.

**Architecture:** A generic engine under `app/lib/import/` (parse → map columns → per-row validate/resolve/dedup → dry-run preview or transactional commit). Each data type is a *descriptor* plugged into the engine; Phase 1 ships one descriptor (client purchase orders). A single `POST /api/import/{type}` route (dry-run flag) drives a new importer page at `/upload`. Each later data type adds only a descriptor + registry entry.

**Tech Stack:** Next.js 15 App Router (route handlers), Drizzle ORM (node-postgres), Zod (via orval codegen from `openapi.yaml`), React Query (orval hooks), papaparse, Vitest, Tailwind + shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-07-13-data-import-engine-design.md`

**Commands you will use repeatedly:**
- Run app tests: `pnpm --filter @workspace/web test`
- Typecheck everything: `pnpm run typecheck`
- Regenerate API client + zod from the spec: `pnpm --filter @workspace/api-spec codegen`

---

## File structure

**Created (engine, `app/lib/import/`):**
- `types.ts` — engine interfaces (`ColumnSpec`, `RowStatus`, `RowResult`, `EngineResult`, `ImportDescriptor`, `ImportSession`).
- `parse.ts` — `parseDelimited(text)` → `{ headers, rows }` (CSV/TSV via papaparse).
- `map-columns.ts` — `normalizeHeader`, `autoMapColumns(headers, columns)` → `key→index`.
- `run-import.ts` — `runImport(descriptor, rows, mapping, opts)` → `EngineResult`.
- `registry.ts` — **server-only** `getDescriptor(type)` (imports the DB-backed descriptors; never import from a client component).
- (No separate catalog file needed in Phase 1: the page imports `clientPurchaseOrdersMeta` — type/label/columns — directly from the client-safe `.columns` file below.)
- `descriptors/cpo-helpers.ts` — pure helpers: `normalizeName`, `parseDateCell`, `dedupKey`, `mmyyKey`, `parseCpoCode`, `seedMaxSeq`, `isoToLocalDate`.
- `descriptors/client-purchase-orders.columns.ts` — **client-safe** column specs + metadata (no DB import).
- `descriptors/client-purchase-orders.ts` — the CPO descriptor (`loadContext`, `resolveRow`, `commit`); imports its columns from the `.columns` file.

> **Client/server boundary:** `@workspace/db` must never reach the browser bundle. The page imports only `parse.ts`, `map-columns.ts`, and the `.columns` metadata file (all DB-free). The DB-backed `registry.ts` / descriptors are imported only by the server route.

**Created (API + tests):**
- `app/app/api/import/[type]/route.ts` — the import route.
- `app/app/api/import/[type]/route.test.ts` — route test.
- `app/lib/import/parse.test.ts`, `map-columns.test.ts`, `run-import.test.ts`, `descriptors/cpo-helpers.test.ts`, `descriptors/client-purchase-orders.test.ts` — unit tests.

**Modified:**
- `lib/api-spec/openapi.yaml` — add `/import/{type}` + `Import*` schemas (Task 8); remove `/upload` + `Upload*` schemas + `uploads` tag (Task 10).
- `app/app/(dashboard)/upload/page.tsx` — replaced with the new importer (Task 9).

**Deleted:**
- `app/app/api/upload/route.ts` (Task 10).
- Generated `Upload*` / `useUploadData` artifacts (removed automatically by `clean: true` on regen in Task 10).

---

## Task 1: Engine types

**Files:**
- Create: `app/lib/import/types.ts`

- [ ] **Step 1: Write the types file**

```typescript
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
```

- [ ] **Step 2: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS (no references to these types yet; file compiles).

- [ ] **Step 3: Commit**

```bash
git add app/lib/import/types.ts
git commit -m "feat(import): engine type definitions"
```

---

## Task 2: CSV/TSV parser

**Files:**
- Create: `app/lib/import/parse.ts`
- Test: `app/lib/import/parse.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/web test parse`
Expected: FAIL with "Cannot find module './parse'".

- [ ] **Step 3: Write minimal implementation**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/web test parse`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/import/parse.ts app/lib/import/parse.test.ts
git commit -m "feat(import): CSV/TSV parser"
```

---

## Task 3: Column auto-mapping

**Files:**
- Create: `app/lib/import/map-columns.ts`
- Test: `app/lib/import/map-columns.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// app/lib/import/map-columns.test.ts
import { describe, it, expect } from "vitest";
import { normalizeHeader, autoMapColumns } from "./map-columns";
import type { ColumnSpec } from "./types";

const columns: ColumnSpec[] = [
  { key: "clientName", label: "Client Name", required: true, aliases: ["client"], example: "Acme" },
  { key: "receiveDate", label: "Receive Date", required: false, aliases: ["received"], example: "2026-01-05" },
];

describe("normalizeHeader", () => {
  it("lowercases and strips non-alphanumerics", () => {
    expect(normalizeHeader("  Client Name! ")).toBe("clientname");
  });
});

describe("autoMapColumns", () => {
  it("maps by key, label, or alias regardless of spacing/case", () => {
    const map = autoMapColumns(["Client", "RECEIVE DATE"], columns);
    expect(map).toEqual({ clientName: 0, receiveDate: 1 });
  });

  it("omits columns with no matching header", () => {
    const map = autoMapColumns(["something"], columns);
    expect(map).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/web test map-columns`
Expected: FAIL with "Cannot find module './map-columns'".

- [ ] **Step 3: Write minimal implementation**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/web test map-columns`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/import/map-columns.ts app/lib/import/map-columns.test.ts
git commit -m "feat(import): column auto-mapping"
```

---

## Task 4: Client-PO helpers (dates, dedup keys, code parsing)

**Files:**
- Create: `app/lib/import/descriptors/cpo-helpers.ts`
- Test: `app/lib/import/descriptors/cpo-helpers.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// app/lib/import/descriptors/cpo-helpers.test.ts
import { describe, it, expect } from "vitest";
import {
  normalizeName, parseDateCell, dedupKey, mmyyKey, isoToLocalDate, parseCpoCode, seedMaxSeq,
} from "./cpo-helpers";

describe("parseDateCell", () => {
  it("returns null for an empty cell", () => {
    const errs: string[] = [];
    expect(parseDateCell("", "Receive Date", errs)).toBeNull();
    expect(errs).toEqual([]);
  });
  it("passes through a valid ISO date", () => {
    const errs: string[] = [];
    expect(parseDateCell("2026-01-05", "Receive Date", errs)).toBe("2026-01-05");
    expect(errs).toEqual([]);
  });
  it("rejects a malformed date with a labelled error", () => {
    const errs: string[] = [];
    expect(parseDateCell("05/01/2026", "Receive Date", errs)).toBeNull();
    expect(errs[0]).toContain("Receive Date");
  });
  it("rejects an impossible date", () => {
    const errs: string[] = [];
    expect(parseDateCell("2026-13-40", "Receive Date", errs)).toBeNull();
    expect(errs.length).toBe(1);
  });
});

describe("dedupKey", () => {
  it("builds a stable key from client + dates", () => {
    expect(dedupKey(7, "2026-01-05", null, "2026-02-01")).toBe("7|2026-01-05||2026-02-01");
  });
});

describe("mmyyKey", () => {
  it("formats month+2-digit-year", () => {
    expect(mmyyKey(isoToLocalDate("2026-01-05"))).toBe("0126");
  });
});

describe("parseCpoCode / seedMaxSeq", () => {
  it("parses a generated code into prefix/mmyy/seq", () => {
    expect(parseCpoCode("CPO-ACME-0126-0003")).toEqual({ prefix: "ACME", mmyy: "0126", seq: 3 });
  });
  it("ignores non-matching codes", () => {
    expect(parseCpoCode("garbage")).toBeNull();
  });
  it("seeds the max sequence per (prefix, mmyy) group", () => {
    const map = seedMaxSeq(["CPO-ACME-0126-0001", "CPO-ACME-0126-0004", "CPO-ACME-0226-0002", "bad"]);
    expect(map.get("ACME|0126")).toBe(4);
    expect(map.get("ACME|0226")).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/web test cpo-helpers`
Expected: FAIL with "Cannot find module './cpo-helpers'".

- [ ] **Step 3: Write minimal implementation**

```typescript
// app/lib/import/descriptors/cpo-helpers.ts

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

/** Parse a "CPO-<prefix>-<mmyy>-<seq>" code. Prefix contains no hyphens. */
export function parseCpoCode(code: string): { prefix: string; mmyy: string; seq: number } | null {
  const m = /^CPO-(.+)-(\d{4})-(\d+)$/.exec(code);
  if (!m) return null;
  return { prefix: m[1], mmyy: m[2], seq: Number(m[3]) };
}

/** Build a map of `${prefix}|${mmyy}` -> highest existing sequence number. */
export function seedMaxSeq(codes: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const code of codes) {
    const parsed = parseCpoCode(code);
    if (!parsed) continue;
    const key = `${parsed.prefix}|${parsed.mmyy}`;
    map.set(key, Math.max(map.get(key) ?? 0, parsed.seq));
  }
  return map;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/web test cpo-helpers`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add app/lib/import/descriptors/cpo-helpers.ts app/lib/import/descriptors/cpo-helpers.test.ts
git commit -m "feat(import): client-PO date/dedup/code helpers"
```

---

## Task 5: Client-PO descriptor — columns + `resolveRow`

This task adds the descriptor's declarative parts and pure per-row resolution. `loadContext`/`commit` are added in Task 6.

**Files:**
- Create: `app/lib/import/descriptors/client-purchase-orders.ts`
- Test: `app/lib/import/descriptors/client-purchase-orders.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// app/lib/import/descriptors/client-purchase-orders.test.ts
import { describe, it, expect } from "vitest";
import { clientPurchaseOrdersDescriptor as d, type CpoContext } from "./client-purchase-orders";

function ctx(overrides: Partial<CpoContext> = {}): CpoContext {
  return {
    clientsByName: new Map([["acme", [{ id: 7, codePrefix: "ACME" }]]]),
    existingKeys: new Set<string>(),
    maxSeqByGroup: new Map<string, number>(),
    ...overrides,
  };
}
const cells = (o: Partial<Record<string, string>>) => ({
  clientName: "", receiveDate: "", startDate: "", endDate: "", ...o,
});

describe("clientPurchaseOrders.resolveRow", () => {
  it("resolves a valid row to a payload", () => {
    const r = d.resolveRow(cells({ clientName: "Acme", receiveDate: "2026-01-05" }), 1, ctx(), new Set());
    expect(r.status).toBe("valid");
    expect(r.payload).toMatchObject({ clientId: 7, prefix: "ACME", receiveDate: "2026-01-05" });
  });

  it("errors on an unknown client", () => {
    const r = d.resolveRow(cells({ clientName: "Nope" }), 1, ctx(), new Set());
    expect(r.status).toBe("error");
    expect(r.messages[0]).toContain("Unknown client");
  });

  it("errors on an ambiguous client name", () => {
    const c = ctx({ clientsByName: new Map([["acme", [{ id: 7, codePrefix: "ACME" }, { id: 8, codePrefix: "ACM2" }]]]) });
    const r = d.resolveRow(cells({ clientName: "Acme" }), 1, c, new Set());
    expect(r.status).toBe("error");
    expect(r.messages[0]).toContain("Ambiguous");
  });

  it("errors when the client has no code prefix", () => {
    const c = ctx({ clientsByName: new Map([["acme", [{ id: 7, codePrefix: "" }]]]) });
    const r = d.resolveRow(cells({ clientName: "Acme" }), 1, c, new Set());
    expect(r.status).toBe("error");
    expect(r.messages[0]).toContain("PO code prefix");
  });

  it("errors when startDate is after endDate", () => {
    const r = d.resolveRow(cells({ clientName: "Acme", startDate: "2026-03-01", endDate: "2026-02-01" }), 1, ctx(), new Set());
    expect(r.status).toBe("error");
    expect(r.messages[0]).toContain("after");
  });

  it("skips a row matching an existing PO (dedup key)", () => {
    const c = ctx({ existingKeys: new Set(["7|2026-01-05||"]) });
    const r = d.resolveRow(cells({ clientName: "Acme", receiveDate: "2026-01-05" }), 1, c, new Set());
    expect(r.status).toBe("skip");
    expect(r.messages[0]).toContain("existing PO");
  });

  it("skips an in-file duplicate", () => {
    const seen = new Set<string>();
    const first = d.resolveRow(cells({ clientName: "Acme", receiveDate: "2026-01-05" }), 1, ctx(), seen);
    const second = d.resolveRow(cells({ clientName: "Acme", receiveDate: "2026-01-05" }), 2, ctx(), seen);
    expect(first.status).toBe("valid");
    expect(second.status).toBe("skip");
    expect(second.messages[0]).toContain("Duplicate row in file");
  });

  it("does not dedup rows that have no dates at all", () => {
    const seen = new Set<string>();
    const first = d.resolveRow(cells({ clientName: "Acme" }), 1, ctx(), seen);
    const second = d.resolveRow(cells({ clientName: "Acme" }), 2, ctx(), seen);
    expect(first.status).toBe("valid");
    expect(second.status).toBe("valid");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/web test client-purchase-orders`
Expected: FAIL with "Cannot find module './client-purchase-orders'".

- [ ] **Step 3: Write the client-safe columns file, then the descriptor**

First the columns (no DB import — safe to import from the client page):

```typescript
// app/lib/import/descriptors/client-purchase-orders.columns.ts
import type { ColumnSpec } from "../types";

export const clientPurchaseOrdersColumns: ColumnSpec[] = [
  { key: "clientName", label: "Client Name", required: true, aliases: ["client"], example: "Acme Corp" },
  { key: "receiveDate", label: "Receive Date", required: false, aliases: ["received", "podate"], example: "2026-01-05" },
  { key: "startDate", label: "Start Date", required: false, aliases: ["campaignstart"], example: "2026-01-10" },
  { key: "endDate", label: "End Date", required: false, aliases: ["campaignend"], example: "2026-02-10" },
];

export const clientPurchaseOrdersMeta = {
  type: "client-purchase-orders",
  label: "Client Purchase Orders",
  columns: clientPurchaseOrdersColumns,
};
```

Then the descriptor (imports the columns; adds DB-backed logic):

```typescript
// app/lib/import/descriptors/client-purchase-orders.ts
import type { ImportDescriptor, RowResult } from "../types";
import { normalizeName, parseDateCell, dedupKey } from "./cpo-helpers";
import { clientPurchaseOrdersColumns } from "./client-purchase-orders.columns";

export interface CpoContext {
  clientsByName: Map<string, Array<{ id: number; codePrefix: string }>>;
  existingKeys: Set<string>;
  maxSeqByGroup: Map<string, number>;
}

export interface CpoPayload {
  clientId: number;
  prefix: string;
  receiveDate: string | null;
  startDate: string | null;
  endDate: string | null;
}

// columns live in ./client-purchase-orders.columns (imported above)

function resolveRow(
  cells: Record<string, string>,
  rowNumber: number,
  ctx: CpoContext,
  seen: Set<string>,
): RowResult<CpoPayload> {
  const messages: string[] = [];
  const error = (msg: string): RowResult<CpoPayload> => ({ rowNumber, status: "error", messages: [msg] });

  const clientName = cells.clientName.trim();
  if (!clientName) return error("Client Name is required");

  const matches = ctx.clientsByName.get(normalizeName(clientName));
  if (!matches || matches.length === 0) return error(`Unknown client: "${clientName}"`);
  if (matches.length > 1) return error(`Ambiguous client name: "${clientName}" matches ${matches.length} clients`);
  const client = matches[0];
  const prefix = client.codePrefix.trim();
  if (!prefix) return error(`Client "${clientName}" has no PO code prefix — set one first`);

  const receiveDate = parseDateCell(cells.receiveDate, "Receive Date", messages);
  const startDate = parseDateCell(cells.startDate, "Start Date", messages);
  const endDate = parseDateCell(cells.endDate, "End Date", messages);
  if (messages.length) return { rowNumber, status: "error", messages };

  if (startDate && endDate && startDate > endDate) {
    return error("Start Date is after End Date");
  }

  const hasDates = Boolean(receiveDate || startDate || endDate);
  if (hasDates) {
    const key = dedupKey(client.id, receiveDate, startDate, endDate);
    if (ctx.existingKeys.has(key)) {
      return { rowNumber, status: "skip", messages: ["Duplicate of an existing PO for this client & dates"] };
    }
    if (seen.has(key)) {
      return { rowNumber, status: "skip", messages: ["Duplicate row in file"] };
    }
    seen.add(key);
  }

  return {
    rowNumber,
    status: "valid",
    messages: [],
    payload: { clientId: client.id, prefix, receiveDate, startDate, endDate },
  };
}

export const clientPurchaseOrdersDescriptor: ImportDescriptor<CpoContext, CpoPayload> = {
  type: "client-purchase-orders",
  label: "Client Purchase Orders",
  columns: clientPurchaseOrdersColumns,
  // Implemented in Task 6:
  async loadContext(): Promise<CpoContext> {
    throw new Error("not implemented");
  },
  resolveRow,
  async commit(): Promise<void> {
    throw new Error("not implemented");
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/web test client-purchase-orders`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/import/descriptors/client-purchase-orders.columns.ts app/lib/import/descriptors/client-purchase-orders.ts app/lib/import/descriptors/client-purchase-orders.test.ts
git commit -m "feat(import): client-PO descriptor columns + row resolution"
```

---

## Task 6: Client-PO descriptor — `loadContext` + `commit` + registry

`loadContext`/`commit` touch the DB, so they're verified by the route test in Task 8 (mocked db). Here we implement them and register the descriptor.

**Files:**
- Modify: `app/lib/import/descriptors/client-purchase-orders.ts`
- Create: `app/lib/import/registry.ts`

- [ ] **Step 1: Replace the stubbed `loadContext` and `commit`**

In `app/lib/import/descriptors/client-purchase-orders.ts`, add these imports at the top (with the existing imports):

```typescript
import { db, clientsTable, clientPurchaseOrdersTable } from "@workspace/db";
import { formatPoCode } from "@/lib/po-codes";
import type { ImportSession } from "../types";
import { isoToLocalDate, mmyyKey, seedMaxSeq } from "./cpo-helpers";
```

Then replace the `loadContext` and `commit` stub bodies in `clientPurchaseOrdersDescriptor` with:

```typescript
  async loadContext(): Promise<CpoContext> {
    const clients = await db
      .select({ id: clientsTable.id, name: clientsTable.name, codePrefix: clientsTable.codePrefix })
      .from(clientsTable);

    const clientsByName = new Map<string, Array<{ id: number; codePrefix: string }>>();
    for (const c of clients) {
      const key = normalizeName(c.name);
      const list = clientsByName.get(key) ?? [];
      list.push({ id: c.id, codePrefix: c.codePrefix ?? "" });
      clientsByName.set(key, list);
    }

    const existing = await db
      .select({
        code: clientPurchaseOrdersTable.code,
        clientId: clientPurchaseOrdersTable.clientId,
        receiveDate: clientPurchaseOrdersTable.receiveDate,
        startDate: clientPurchaseOrdersTable.startDate,
        endDate: clientPurchaseOrdersTable.endDate,
      })
      .from(clientPurchaseOrdersTable);

    const existingKeys = new Set<string>();
    for (const r of existing) {
      existingKeys.add(dedupKey(r.clientId, r.receiveDate ?? null, r.startDate ?? null, r.endDate ?? null));
    }
    const maxSeqByGroup = seedMaxSeq(existing.map((r) => r.code));

    return { clientsByName, existingKeys, maxSeqByGroup };
  },
```

```typescript
  async commit(payloads: CpoPayload[], ctx: CpoContext, session: ImportSession): Promise<void> {
    const counters = new Map(ctx.maxSeqByGroup);
    await db.transaction(async (tx) => {
      for (const p of payloads) {
        const date = p.receiveDate ? isoToLocalDate(p.receiveDate) : new Date();
        const group = `${p.prefix}|${mmyyKey(date)}`;
        const next = (counters.get(group) ?? 0) + 1;
        counters.set(group, next);
        const code = formatPoCode(p.prefix, date, next);
        await tx.insert(clientPurchaseOrdersTable).values({
          code,
          clientId: p.clientId,
          attachmentUrl: "",
          attachmentName: null,
          attachments: [],
          receiveDate: p.receiveDate,
          startDate: p.startDate,
          endDate: p.endDate,
          createdById: session.userId,
        });
      }
    });
  },
```

- [ ] **Step 2: Create the registry**

```typescript
// app/lib/import/registry.ts
import type { ImportDescriptor } from "./types";
import { clientPurchaseOrdersDescriptor } from "./descriptors/client-purchase-orders";

// Heterogeneous descriptors — ctx/payload types differ per entry.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const registry: Record<string, ImportDescriptor<any, any>> = {
  [clientPurchaseOrdersDescriptor.type]: clientPurchaseOrdersDescriptor,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getDescriptor(type: string): ImportDescriptor<any, any> | undefined {
  return registry[type];
}

/** Descriptor metadata for the UI type picker. */
export function listDescriptors(): Array<{ type: string; label: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Object.values(registry).map((d: ImportDescriptor<any, any>) => ({ type: d.type, label: d.label }));
}
```

- [ ] **Step 3: Typecheck + re-run the descriptor tests**

Run: `pnpm run typecheck`
Expected: PASS.
Run: `pnpm --filter @workspace/web test client-purchase-orders`
Expected: PASS (pure resolveRow tests still green; loadContext/commit untested here).

- [ ] **Step 4: Commit**

```bash
git add app/lib/import/descriptors/client-purchase-orders.ts app/lib/import/registry.ts
git commit -m "feat(import): client-PO loadContext/commit + descriptor registry"
```

---

## Task 7: Engine orchestrator (`run-import`)

**Files:**
- Create: `app/lib/import/run-import.ts`
- Test: `app/lib/import/run-import.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/web test run-import`
Expected: FAIL with "Cannot find module './run-import'".

- [ ] **Step 3: Write the orchestrator**

```typescript
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

  const ctx = await descriptor.loadContext();
  const seen = new Set<string>();
  const results: RowResult<TPayload>[] = [];

  for (let i = 0; i < rows.length; i++) {
    const cells: Record<string, string> = {};
    for (const col of descriptor.columns) {
      const idx = mapping[col.key];
      cells[col.key] = idx == null ? "" : (rows[i][idx] ?? "").trim();
    }
    results.push(descriptor.resolveRow(cells, i + 1, ctx, seen));
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/web test run-import`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/import/run-import.ts app/lib/import/run-import.test.ts
git commit -m "feat(import): engine orchestrator (dry-run + commit)"
```

---

## Task 8: API spec + route (`POST /api/import/{type}`)

Adds the endpoint to the spec (keeping legacy `/upload` for now so the build stays green), regenerates, and implements + tests the route.

**Files:**
- Modify: `lib/api-spec/openapi.yaml`
- Create: `app/app/api/import/[type]/route.ts`
- Create: `app/app/api/import/[type]/route.test.ts`

- [ ] **Step 1: Add the path to `openapi.yaml`**

Insert this block immediately after the existing `/upload` path block (after its `"400": description: Validation error` line, before the `# ── Analytics & Dashboard ──` comment):

```yaml
  # ── Data Import ───────────────────────────────────────────────────────────────
  /import/{type}:
    post:
      operationId: runImport
      tags: [import]
      summary: Validate (dry-run) or commit a bulk data import for the given type
      parameters:
        - name: type
          in: path
          required: true
          schema:
            type: string
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/ImportRequest"
      responses:
        "200":
          description: Import result (dry-run preview or committed summary)
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ImportResult"
        "400":
          description: Unknown import type or invalid request
```

- [ ] **Step 2: Add the schemas to `openapi.yaml`**

Add these under `components: schemas:` (place them right before the `UploadRow:` schema so they sit near the other import/upload types):

```yaml
    ImportRequest:
      type: object
      required: [mapping, rows, dryRun]
      properties:
        mapping:
          type: object
          additionalProperties:
            type: integer
        rows:
          type: array
          items:
            type: array
            items:
              type: string
        dryRun:
          type: boolean
    ImportRowResult:
      type: object
      required: [rowNumber, status, messages]
      properties:
        rowNumber:
          type: integer
        status:
          type: string
          enum: [valid, skip, error]
        messages:
          type: array
          items:
            type: string
    ImportResult:
      type: object
      required: [total, valid, skipped, errored, fileErrors, rows]
      properties:
        total:
          type: integer
        valid:
          type: integer
        skipped:
          type: integer
        errored:
          type: integer
        fileErrors:
          type: array
          items:
            type: string
        rows:
          type: array
          items:
            $ref: "#/components/schemas/ImportRowResult"
```

Also add a tag entry under the top-level `tags:` list (leave `uploads` in place for now — it is removed in Task 10):

```yaml
  - name: import
    description: Bulk data import
```

- [ ] **Step 3: Regenerate the API client + zod, then typecheck**

Run: `pnpm --filter @workspace/api-spec codegen`
Expected: regenerates `lib/api-zod/**` and `lib/api-client-react/**`; the `codegen` script also runs `typecheck:libs`, which should PASS.

Verify the generated hook exists:
Run: `pnpm --filter @workspace/web exec grep -r "useRunImport" ../lib/api-client-react/src/index.ts`
Expected: at least one match (the generated mutation hook is re-exported).

- [ ] **Step 4: Write the failing route test**

```typescript
// app/app/api/import/[type]/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const insertValues = vi.fn();
const transaction = vi.fn(async (cb: (tx: unknown) => Promise<void>) =>
  cb({ insert: () => ({ values: insertValues }) }),
);

// Table sentinels so loadContext can tell which select is which.
const clientsTable = { __t: "clients" };
const clientPurchaseOrdersTable = { __t: "cpo" };

let clientRows: unknown[] = [];
let cpoRows: unknown[] = [];

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({
      from: (t: { __t: string }) => (t.__t === "clients" ? clientRows : cpoRows),
    }),
    transaction,
  },
  clientsTable,
  clientPurchaseOrdersTable,
}));

vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(async () => ({ sub: 42, name: "Tester", email: "t@x.com", role: "Admin", isSystem: true })),
}));

function call(type: string, body: unknown) {
  return import("./route").then(({ POST }) =>
    POST(
      new Request(`http://localhost/api/import/${type}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ type }) },
    ),
  );
}

beforeEach(() => {
  insertValues.mockClear();
  transaction.mockClear();
  clientRows = [{ id: 7, name: "Acme", codePrefix: "ACME" }];
  cpoRows = [];
});

describe("POST /api/import/{type}", () => {
  it("returns 400 for an unknown import type", async () => {
    const res = await call("nonsense", { mapping: {}, rows: [["x"]], dryRun: true });
    expect(res.status).toBe(400);
  });

  it("dry-run returns per-row statuses and does not write", async () => {
    const res = await call("client-purchase-orders", {
      mapping: { clientName: 0, receiveDate: 1 },
      rows: [["Acme", "2026-01-05"], ["Ghost", "2026-01-05"]],
      dryRun: true,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(1);
    expect(body.errored).toBe(1);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("commit inserts valid rows", async () => {
    const res = await call("client-purchase-orders", {
      mapping: { clientName: 0, receiveDate: 1 },
      rows: [["Acme", "2026-01-05"]],
      dryRun: false,
    });
    expect(res.status).toBe(200);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledTimes(1);
    const inserted = insertValues.mock.calls[0][0];
    expect(inserted).toMatchObject({ clientId: 7, attachmentUrl: "", createdById: 42 });
    expect(inserted.code).toMatch(/^CPO-ACME-\d{4}-0001$/);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm --filter @workspace/web test "import/\[type\]"`
Expected: FAIL with "Cannot find module './route'".

- [ ] **Step 6: Write the route**

```typescript
// app/app/api/import/[type]/route.ts
import { NextResponse } from "next/server";
import { RunImportBody, RunImportParams } from "@workspace/api-zod";
import { getSession } from "@/lib/auth/session";
import { getDescriptor } from "@/lib/import/registry";
import { runImport } from "@/lib/import/run-import";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ type: string }> },
): Promise<Response> {
  const { type } = await params;
  const p = RunImportParams.safeParse({ type });
  if (!p.success) return NextResponse.json({ error: p.error.message }, { status: 400 });

  const descriptor = getDescriptor(type);
  if (!descriptor) return NextResponse.json({ error: `Unknown import type: ${type}` }, { status: 400 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = RunImportBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const session = await getSession();
  const result = await runImport(descriptor, parsed.data.rows, parsed.data.mapping, {
    dryRun: parsed.data.dryRun,
    session: { userId: session?.sub ?? null },
  });
  return NextResponse.json(result);
}
```

> Note on generated names: orval derives `RunImportBody`/`RunImportParams` from `operationId: runImport`. If codegen produced different identifiers, open `lib/api-zod/src/index.ts` and use the exported names for the `/import/{type}` operation's body and path params.

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @workspace/web test "import/\[type\]"`
Expected: PASS (3 tests).

- [ ] **Step 8: Typecheck + commit**

Run: `pnpm run typecheck`
Expected: PASS.

```bash
git add lib/api-spec/openapi.yaml lib/api-zod lib/api-client-react app/app/api/import
git commit -m "feat(import): /api/import/{type} route + generated client"
```

---

## Task 9: Importer page (replace `/upload`)

Replaces the legacy page. It parses the file, auto-maps columns, runs a server dry-run for preview, then commits.

**Files:**
- Modify (full replace): `app/app/(dashboard)/upload/page.tsx`

- [ ] **Step 1: Replace the page contents**

```tsx
// app/app/(dashboard)/upload/page.tsx
"use client";

import { useCallback, useMemo, useState } from "react";
import { Upload, FileText, CheckCircle, XCircle, AlertCircle, Download } from "lucide-react";
import { useRunImport, getListClientPurchaseOrdersQueryKey } from "@workspace/api-client-react";
import type { ImportResult } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import Papa from "papaparse";
import { PermissionGuard } from "@/components/PermissionGuard";
import { parseDelimited } from "@/lib/import/parse";
import { autoMapColumns } from "@/lib/import/map-columns";
import { clientPurchaseOrdersMeta } from "@/lib/import/descriptors/client-purchase-orders.columns";

const IMPORT_TYPE = "client-purchase-orders";

export default function ImportPage() {
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const entry = clientPurchaseOrdersMeta;
  const columns = entry.columns;

  const missingRequired = useMemo(
    () => columns.filter((c) => c.required && mapping[c.key] == null).map((c) => c.label),
    [columns, mapping],
  );

  const runImportMutation = useRunImport({
    mutation: {
      onError: () => toast({ title: "Import failed", variant: "destructive" }),
    },
  });

  const reset = () => {
    setFileName(""); setHeaders([]); setRows([]); setMapping({}); setPreview(null); setResult(null);
  };

  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const parsed = parseDelimited(e.target?.result as string);
      if (parsed.rows.length === 0) {
        toast({ title: "File has no data rows", variant: "destructive" });
        return;
      }
      setFileName(file.name);
      setHeaders(parsed.headers);
      setRows(parsed.rows);
      setMapping(autoMapColumns(parsed.headers, columns));
      setPreview(null);
      setResult(null);
    };
    reader.readAsText(file);
  }, [columns, toast]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const runDryRun = () => {
    runImportMutation.mutate(
      { type: IMPORT_TYPE, data: { mapping, rows, dryRun: true } },
      { onSuccess: (data: ImportResult) => {
          setPreview(data);
          if (data.fileErrors.length) toast({ title: data.fileErrors.join("; "), variant: "destructive" });
        } },
    );
  };

  const runCommit = () => {
    runImportMutation.mutate(
      { type: IMPORT_TYPE, data: { mapping, rows, dryRun: false } },
      { onSuccess: (data: ImportResult) => {
          setResult(data);
          qc.invalidateQueries({ queryKey: getListClientPurchaseOrdersQueryKey() });
        } },
    );
  };

  const downloadTemplate = () => {
    const csv = Papa.unparse([columns.map((c) => c.label), columns.map((c) => c.example)]);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${IMPORT_TYPE}-template.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const downloadErrors = (res: ImportResult) => {
    const bad = res.rows.filter((r) => r.status !== "valid");
    const csv = Papa.unparse([["row", "status", "messages"], ...bad.map((r) => [r.rowNumber, r.status, r.messages.join(" | ")])]);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${IMPORT_TYPE}-errors.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const statusClass = (s: string) =>
    s === "valid" ? "text-emerald-600" : s === "skip" ? "text-amber-600" : "text-red-600";

  return (
    <PermissionGuard permission="Upload Data">
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Import Data</h1>
            <p className="text-sm text-muted-foreground">Bulk-import records from a CSV/TSV file. Entities are matched by name.</p>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={downloadTemplate}>
            <Download className="h-3.5 w-3.5" /> Download template
          </Button>
        </div>

        {/* Type selector — only Client POs enabled in Phase 1 */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <label className="text-sm font-semibold text-foreground">Data type</label>
          <Select value={IMPORT_TYPE} onValueChange={() => {}}>
            <SelectTrigger className="mt-2 w-72 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[clientPurchaseOrdersMeta].map((d) => (
                <SelectItem key={d.type} value={d.type}>{d.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-2 text-xs text-muted-foreground">More types (partner POs, billing, payments) coming in later phases.</p>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            "relative rounded-2xl border-2 border-dashed p-12 text-center transition-all",
            dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30",
          )}
          data-testid="drop-zone"
        >
          <input
            type="file" accept=".csv,.tsv,.txt"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            className="absolute inset-0 opacity-0 cursor-pointer" data-testid="file-input"
          />
          <div className="flex flex-col items-center gap-3">
            <div className="rounded-2xl bg-primary/10 p-4 text-primary"><Upload className="h-8 w-8" /></div>
            <p className="text-sm font-semibold text-foreground">Drag &amp; drop your CSV/TSV file</p>
            <p className="text-xs text-muted-foreground">or click to browse</p>
          </div>
        </div>

        {/* Mapping + preview trigger */}
        {rows.length > 0 && !result && (
          <div className="rounded-2xl border border-border bg-card shadow-sm">
            <div className="border-b border-border px-5 py-4 flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">{fileName}</h2>
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium">{rows.length} rows</span>
            </div>
            <div className="p-5 grid gap-3 sm:grid-cols-2">
              {columns.map((col) => (
                <div key={col.key} className="flex items-center gap-2">
                  <span className="w-32 text-xs text-muted-foreground">
                    {col.label}{col.required && <span className="text-red-500"> *</span>}
                  </span>
                  <Select
                    value={mapping[col.key] != null ? String(mapping[col.key]) : "none"}
                    onValueChange={(v) => setMapping((m) => {
                      const next = { ...m };
                      if (v === "none") delete next[col.key]; else next[col.key] = parseInt(v, 10);
                      return next;
                    })}
                  >
                    <SelectTrigger className="w-44 text-xs"><SelectValue placeholder="Not mapped" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— not mapped —</SelectItem>
                      {headers.map((h, i) => <SelectItem key={i} value={String(i)}>{h}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <div className="border-t border-border px-5 py-4 flex items-center justify-end gap-3">
              {missingRequired.length > 0 && (
                <span className="mr-auto text-xs text-red-600">Map required column(s): {missingRequired.join(", ")}</span>
              )}
              <Button variant="outline" size="sm" onClick={reset}>Clear</Button>
              <Button size="sm" disabled={missingRequired.length > 0 || runImportMutation.isPending} onClick={runDryRun} data-testid="preview-btn">
                {runImportMutation.isPending ? "Checking…" : "Preview"}
              </Button>
            </div>
          </div>
        )}

        {/* Preview results */}
        {preview && !result && preview.fileErrors.length === 0 && (
          <div className="rounded-2xl border border-border bg-card shadow-sm">
            <div className="border-b border-border px-5 py-4 flex items-center gap-4 text-xs">
              <span className="text-emerald-600 font-semibold">{preview.valid} valid</span>
              <span className="text-amber-600 font-semibold">{preview.skipped} skip</span>
              <span className="text-red-600 font-semibold">{preview.errored} error</span>
            </div>
            <div className="max-h-72 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                  <tr className="border-b border-border">
                    <th className="px-4 py-2 text-left text-muted-foreground">Row</th>
                    <th className="px-4 py-2 text-left text-muted-foreground">Status</th>
                    <th className="px-4 py-2 text-left text-muted-foreground">Messages</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.filter((r) => r.status !== "valid").map((r) => (
                    <tr key={r.rowNumber} className="border-b border-border last:border-0">
                      <td className="px-4 py-1.5">{r.rowNumber}</td>
                      <td className={cn("px-4 py-1.5 font-medium", statusClass(r.status))}>{r.status}</td>
                      <td className="px-4 py-1.5 text-muted-foreground">{r.messages.join("; ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-border px-5 py-4 flex justify-end gap-3">
              <Button variant="outline" size="sm" onClick={() => setPreview(null)}>Back</Button>
              <Button size="sm" disabled={preview.valid === 0 || runImportMutation.isPending} onClick={runCommit} data-testid="import-btn">
                {runImportMutation.isPending ? "Importing…" : `Import ${preview.valid} valid rows`}
              </Button>
            </div>
          </div>
        )}

        {/* Final result */}
        {result && (
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-foreground mb-4">Import Result</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
              <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 p-3 flex items-center gap-3">
                <CheckCircle className="h-5 w-5 text-emerald-600" />
                <div><p className="text-lg font-bold text-emerald-700">{result.valid}</p><p className="text-xs text-emerald-600">Imported</p></div>
              </div>
              <div className="rounded-xl bg-amber-50 dark:bg-amber-950/40 p-3 flex items-center gap-3">
                <AlertCircle className="h-5 w-5 text-amber-600" />
                <div><p className="text-lg font-bold text-amber-700">{result.skipped}</p><p className="text-xs text-amber-600">Skipped</p></div>
              </div>
              <div className="rounded-xl bg-red-50 dark:bg-red-950/40 p-3 flex items-center gap-3">
                <XCircle className="h-5 w-5 text-red-600" />
                <div><p className="text-lg font-bold text-red-700">{result.errored}</p><p className="text-xs text-red-600">Errors</p></div>
              </div>
            </div>
            {(result.errored > 0 || result.skipped > 0) && (
              <Button variant="outline" size="sm" className="mr-2" onClick={() => downloadErrors(result)}>Download error report</Button>
            )}
            <Button variant="outline" size="sm" onClick={reset}>Import another file</Button>
          </div>
        )}
      </div>
    </PermissionGuard>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm run typecheck`
Expected: PASS.

> If `ImportResult` is not exported from `@workspace/api-client-react`, import the type from `@workspace/api-zod` instead (check `lib/api-zod/src/index.ts` for the exported `ImportResult` type name).

- [ ] **Step 3: Manual verification (dev server)**

Run: `pnpm --filter @workspace/web dev`
Then, logged in as a user with the "Upload Data" permission, open `/upload` and confirm:
- "Download template" produces a CSV with the four column headers.
- Dropping that template (with a real client name + dates) shows a mapping grid, then Preview shows counts, then Import creates the PO (visible on the client's PO list) with an auto-generated `CPO-…` code.
- Re-importing the same file shows those rows as **skip**.

- [ ] **Step 4: Commit**

```bash
git add "app/app/(dashboard)/upload/page.tsx"
git commit -m "feat(import): importer page for client purchase orders"
```

---

## Task 10: Remove the legacy upload

Now that nothing references the old upload, delete it and clean the spec.

**Files:**
- Modify: `lib/api-spec/openapi.yaml`
- Delete: `app/app/api/upload/route.ts`

- [ ] **Step 1: Confirm nothing references the legacy hook**

Run: `pnpm --filter @workspace/web exec grep -rn "useUploadData\|UploadDataBody\|UploadDataResponse" app`
Expected: **no matches** (the new page replaced the only consumer). If there are matches, fix them before continuing.

- [ ] **Step 2: Remove the legacy spec entries from `openapi.yaml`**

- Delete the `/upload` path block (the `# ── Data Upload ──` comment + the `/upload:` post operation).
- Delete the `UploadPayload`, `UploadRow`, and `UploadDataResult` schemas under `components: schemas:`.
- Delete the `- name: uploads` / `description: Data upload operations` entry from the top-level `tags:` list.

- [ ] **Step 3: Delete the legacy route file**

```bash
git rm app/app/api/upload/route.ts
```

- [ ] **Step 4: Regenerate + typecheck**

Run: `pnpm --filter @workspace/api-spec codegen`
Expected: regenerates and removes the `uploadData*` artifacts (`clean: true`); `typecheck:libs` PASSES.

Run: `pnpm run typecheck`
Expected: PASS (no dangling references to `useUploadData`).

- [ ] **Step 5: Full test run**

Run: `pnpm --filter @workspace/web test`
Expected: PASS (all import + existing tests).

- [ ] **Step 6: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-zod lib/api-client-react app/app/api/upload
git commit -m "chore(import): remove legacy campaigns/transactions upload"
```

---

## Task 11: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Typecheck the whole workspace**

Run: `pnpm run typecheck`
Expected: PASS.

- [ ] **Step 2: Run the full app test suite**

Run: `pnpm --filter @workspace/web test`
Expected: PASS.

- [ ] **Step 3: End-to-end dogfood against the spec's acceptance points**

With the dev server running and a client that has a `codePrefix`:
- Import a CSV of 2–3 POs with valid client names + dates → all `valid`, POs appear with sequential `CPO-<prefix>-MMYY-NNNN` codes.
- Include a row with an unknown client and a row with a bad date → they show as `error` in preview and are excluded from the commit.
- Re-import the same file → previously-imported rows show as `skip`; nothing duplicated.
- Import a row for a client with a blank `codePrefix` → `error` naming the prefix.
- Confirm the imported POs have no attachment and can have a PDF attached afterward via the existing PO detail dialog.

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A
git commit -m "test(import): phase 1 verification fixes"
```

---

## Self-review notes (for the implementer)

- **Generated identifier names:** orval derives zod/hook names from `operationId: runImport` → `RunImportBody`, `RunImportParams`, `RunImportResponse`, `useRunImport`. If your orval version emits different names, read `lib/api-zod/src/index.ts` and `lib/api-client-react/src/index.ts` and adjust the imports in the route (Task 8) and page (Task 9) accordingly.
- **`db.transaction`:** node-postgres Drizzle supports `db.transaction(async (tx) => …)`. This is the codebase's first use; the route test mocks it. Concurrency note: batch code sequences are race-safe only within a single import (acceptable for this internal tool).
- **Attachments:** inserting `attachmentUrl: ""` + `attachments: []` satisfies the `NOT NULL` column and renders as "no attachments" (no schema migration).