# Import Engine — Phase 2 (Partner POs + Sample View) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a grouped-import capability to the engine and ship the Partner PO importer on it, plus a shared on-page "Expected columns" view + richer sample CSV that every importer inherits.

**Architecture:** Extend the descriptor into a discriminated union — `FlatImportDescriptor` (existing, `resolveRow`) vs `GroupedImportDescriptor` (`groupBy` + `resolveGroup`); `run-import` branches on `groupBy`. The Partner PO descriptor groups CSV rows by a `poReference` column into one PO-with-line-items, resolves partner/client-PO/event by name/code, computes budgets, and generates `PPO-` codes. A new client-safe `catalog.ts` drives a multi-type picker + sample UI on the shared `/upload` page.

**Tech Stack:** Next.js 15 App Router, Drizzle ORM (node-postgres), Zod (orval codegen), React Query, papaparse, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-15-import-engine-phase2-partner-pos-design.md`
**Builds on shipped Phase 1:** `docs/superpowers/specs/2026-07-13-data-import-engine-design.md`

**Commands:**
- App tests: `pnpm --filter @workspace/web test [name]`
- App typecheck: `pnpm --filter @workspace/web typecheck` (use this, NOT `pnpm run typecheck` — the latter is pre-existingly red on an unrelated `scripts/src/seed.ts` error)
- App build (client-bundle check): `pnpm --filter @workspace/web build`

---

## File structure

**Created:**
- `app/lib/import/po-code-seq.ts` (+ test) — tag-agnostic PO-code parsing + batch sequence seeding (shared by CPO/PPO).
- `app/lib/import/descriptors/partner-purchase-orders.columns.ts` — client-safe columns + `partnerPurchaseOrdersMeta` (with `note`s + `sampleRows`).
- `app/lib/import/descriptors/partner-purchase-orders.ts` (+ test) — the `GroupedImportDescriptor`.
- `app/lib/import/catalog.ts` — client-safe catalog of importer metadata (both types).
- `app/app/api/import/[type]/partner-route.test.ts` — partner-PO route test.

**Modified:**
- `app/lib/import/types.ts` — add `ColumnSpec.note?`; split `ImportDescriptor` into `Flat | Grouped` union.
- `app/lib/import/run-import.ts` (+ `run-import.test.ts`) — branch on `groupBy` for grouped imports.
- `app/lib/import/registry.ts` — register the partner descriptor.
- `app/lib/import/descriptors/client-purchase-orders.columns.ts` — add `note`s + `sampleRows` (so Phase 1 gets the sample UI too).
- `app/app/(dashboard)/upload/page.tsx` — multi-type picker, "Expected columns" card, richer "Download sample CSV".

**Near-unchanged (verify still green):** `cpo-helpers.ts` and all Phase-1 tests keep working without edits; `client-purchase-orders.ts` needs only a 2-token type-annotation change (`ImportDescriptor` → `FlatImportDescriptor`, see Task 1 Step 5) — no behavior change.

---

## Task 1: Engine grouped-import support

**Files:**
- Modify: `app/lib/import/types.ts`
- Modify: `app/lib/import/run-import.ts`
- Test: `app/lib/import/run-import.test.ts`

- [ ] **Step 1: Add the grouped test cases (append to the existing `run-import.test.ts`)**

Add these imports/helpers and tests to `app/lib/import/run-import.test.ts` (keep the existing flat tests as-is). Add `GroupedImportDescriptor` to the type import from `./types`:

```typescript
import type { GroupedImportDescriptor } from "./types";

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
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `pnpm --filter @workspace/web test run-import`
Expected: FAIL — `GroupedImportDescriptor` is not exported from `./types` yet.

- [ ] **Step 3: Update `types.ts` — add `note` and the discriminated union**

Replace the `ColumnSpec` interface and the `ImportDescriptor` interface in `app/lib/import/types.ts` with:

```typescript
/** One logical column an importer expects in the uploaded file. */
export interface ColumnSpec {
  key: string;        // canonical field name, e.g. "clientName"
  label: string;      // template header + mapping UI label
  required: boolean;
  aliases: string[];  // additional header spellings for auto-mapping
  example: string;    // sample value used in the downloadable sample CSV
  note?: string;      // one-line "what goes here", shown in the Expected-columns table
}
```

```typescript
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
```

(Leave `RowStatus`, `RowResult`, `EngineResult`, `ImportSession` unchanged.)

- [ ] **Step 4: Update `run-import.ts` to branch on `groupBy`**

Replace the body of `app/lib/import/run-import.ts` with:

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

  if (rows.length === 0) return { ...empty, fileErrors: ["File has no data rows"] };
  if (rows.length > MAX_ROWS) {
    return { ...empty, fileErrors: [`Too many rows (${rows.length}). Split into files of at most ${MAX_ROWS} rows.`] };
  }
  const missing = descriptor.columns
    .filter((c) => c.required && mapping[c.key] == null)
    .map((c) => c.label);
  if (missing.length) return { ...empty, fileErrors: [`Missing required column(s): ${missing.join(", ")}`] };

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
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @workspace/web test run-import`
Expected: PASS (existing flat tests + 3 new grouped tests).
Run: `pnpm --filter @workspace/web typecheck`
Expected: PASS — after one required Phase-1 accommodation. Because `clientPurchaseOrdersDescriptor` is *exported with a type annotation*, once `ImportDescriptor` is a union its Phase-1 test's `d.resolveRow(...)` no longer typechecks (you can't access `resolveRow` on the union without narrowing). Fix by typing the descriptor as its concrete `Flat` variant (the registry still holds the union — a `FlatImportDescriptor` is assignable to it). In `app/lib/import/descriptors/client-purchase-orders.ts`:
- change the import to `import type { FlatImportDescriptor, RowResult } from "../types";` (was `ImportDescriptor`)
- change the annotation to `export const clientPurchaseOrdersDescriptor: FlatImportDescriptor<CpoContext, CpoPayload> = {` (was `ImportDescriptor<...>`)

Then `pnpm --filter @workspace/web typecheck` must be fully green, and `client-purchase-orders.ts`/`cpo-helpers.ts` behavior is otherwise unchanged.

- [ ] **Step 6: Commit**

```bash
git add app/lib/import/types.ts app/lib/import/run-import.ts app/lib/import/run-import.test.ts
git commit -m "feat(import): grouped-import capability (discriminated descriptor)"
```

---

## Task 2: Tagged PO-code sequencing helper

**Files:**
- Create: `app/lib/import/po-code-seq.ts`
- Test: `app/lib/import/po-code-seq.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// app/lib/import/po-code-seq.test.ts
import { describe, it, expect } from "vitest";
import { parsePoCode, seedMaxSeq } from "./po-code-seq";

describe("parsePoCode", () => {
  it("parses tag/prefix/mmyy/seq", () => {
    expect(parsePoCode("PPO-ACME-0126-0003")).toEqual({ tag: "PPO", prefix: "ACME", mmyy: "0126", seq: 3 });
    expect(parsePoCode("CPO-BETA2-0226-0012")).toEqual({ tag: "CPO", prefix: "BETA2", mmyy: "0226", seq: 12 });
  });
  it("returns null for non-matching codes", () => {
    expect(parsePoCode("garbage")).toBeNull();
  });
});

describe("seedMaxSeq", () => {
  it("keeps the max sequence per (prefix, mmyy) for the given tag only", () => {
    const map = seedMaxSeq(
      ["PPO-ACME-0126-0001", "PPO-ACME-0126-0004", "PPO-ACME-0226-0002", "CPO-ACME-0126-0009", "bad"],
      "PPO",
    );
    expect(map.get("ACME|0126")).toBe(4);
    expect(map.get("ACME|0226")).toBe(2);
    expect(map.size).toBe(2); // the CPO code is excluded
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/web test po-code-seq`
Expected: FAIL with "Cannot find module './po-code-seq'".

- [ ] **Step 3: Write the implementation**

```typescript
// app/lib/import/po-code-seq.ts
// Tag-agnostic parsing + batch sequence seeding for PO codes: "<TAG>-<prefix>-<mmyy>-<seq>".
// Shared by client POs (tag "CPO") and partner POs (tag "PPO").

export function parsePoCode(code: string): { tag: string; prefix: string; mmyy: string; seq: number } | null {
  const m = /^([A-Za-z]+)-(.+)-(\d{4})-(\d+)$/.exec(code);
  if (!m) return null;
  return { tag: m[1], prefix: m[2], mmyy: m[3], seq: Number(m[4]) };
}

/** Highest existing sequence per `${prefix}|${mmyy}` among codes carrying the given tag. */
export function seedMaxSeq(codes: string[], tag: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const code of codes) {
    const p = parsePoCode(code);
    if (!p || p.tag !== tag) continue;
    const key = `${p.prefix}|${p.mmyy}`;
    map.set(key, Math.max(map.get(key) ?? 0, p.seq));
  }
  return map;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/web test po-code-seq`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/import/po-code-seq.ts app/lib/import/po-code-seq.test.ts
git commit -m "feat(import): tagged PO-code sequencing helper"
```

---

## Task 3: Partner PO columns/metadata + `resolveGroup`

**Files:**
- Create: `app/lib/import/descriptors/partner-purchase-orders.columns.ts`
- Create: `app/lib/import/descriptors/partner-purchase-orders.ts`
- Test: `app/lib/import/descriptors/partner-purchase-orders.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// app/lib/import/descriptors/partner-purchase-orders.test.ts
import { describe, it, expect, vi } from "vitest";

// The descriptor (after Task 4) imports @workspace/db, which throws at module-load
// without DATABASE_URL. Mock it so the pure resolveGroup tests can load/run.
vi.mock("@workspace/db", () => ({
  db: {}, partnerPurchaseOrdersTable: {}, partnerPurchaseOrderItemsTable: {},
  partnersTable: {}, clientPurchaseOrdersTable: {}, clientEventsTable: {},
}));

import { partnerPurchaseOrdersDescriptor as d, type PpoContext } from "./partner-purchase-orders";

function ctx(over: Partial<PpoContext> = {}): PpoContext {
  return {
    partnersByName: new Map([["acme media", [{ id: 3, codePrefix: "ACME" }]]]),
    cpoByCode: new Map([["CPO-ACME-0126-0001", { id: 11, clientId: 7 }]]),
    eventsByClientAndName: new Map([
      ["7|install", [{ id: 21 }]],
      ["7|signup", [{ id: 22 }]],
    ]),
    existingKeys: new Set<string>(),
    maxSeqByGroup: new Map<string, number>(),
    ...over,
  };
}
const row = (o: Partial<Record<string, string>>, rowNumber: number) => ({
  cells: { poReference: "PO-1", partnerName: "", clientPoCode: "", startDate: "", endDate: "", notes: "", eventName: "", cacRate: "", eventCount: "", ...o },
  rowNumber,
});

describe("partnerPurchaseOrders.resolveGroup", () => {
  const header = { partnerName: "Acme Media", clientPoCode: "CPO-ACME-0126-0001", startDate: "2026-01-10", endDate: "2026-02-10" };

  it("resolves a multi-item group into one payload", () => {
    const r = d.resolveGroup([
      row({ ...header, eventName: "Install", cacRate: "2.5", eventCount: "1000" }, 1),
      row({ ...header, eventName: "Signup", cacRate: "1", eventCount: "500" }, 2),
    ], ctx(), new Set());
    expect(r.status).toBe("valid");
    expect(r.payload).toMatchObject({ partnerId: 3, prefix: "ACME", clientPurchaseOrderId: 11 });
    expect(r.payload!.items).toHaveLength(2);
    expect(r.payload!.items[0]).toMatchObject({ clientEventId: 21, cacRate: 2.5, eventCount: 1000 });
  });

  it("errors on unknown partner", () => {
    const r = d.resolveGroup([row({ ...header, partnerName: "Nope", eventName: "Install", cacRate: "1", eventCount: "1" }, 1)], ctx(), new Set());
    expect(r.status).toBe("error");
    expect(r.messages[0]).toContain("Unknown partner");
  });

  it("errors on unknown client PO code", () => {
    const r = d.resolveGroup([row({ ...header, clientPoCode: "CPO-X-0000-0000", eventName: "Install", cacRate: "1", eventCount: "1" }, 1)], ctx(), new Set());
    expect(r.status).toBe("error");
    expect(r.messages[0]).toContain("Unknown client PO");
  });

  it("errors on an unknown event for the client", () => {
    const r = d.resolveGroup([row({ ...header, eventName: "Ghost", cacRate: "1", eventCount: "1" }, 1)], ctx(), new Set());
    expect(r.status).toBe("error");
    expect(r.messages[0]).toContain("Unknown event");
  });

  it("errors on conflicting header within the group", () => {
    const r = d.resolveGroup([
      row({ ...header, eventName: "Install", cacRate: "1", eventCount: "1" }, 1),
      row({ ...header, endDate: "2026-03-01", eventName: "Signup", cacRate: "1", eventCount: "1" }, 2),
    ], ctx(), new Set());
    expect(r.status).toBe("error");
    expect(r.messages[0]).toContain("Conflicting");
  });

  it("errors when start is after end", () => {
    const r = d.resolveGroup([row({ ...header, startDate: "2026-03-01", endDate: "2026-02-01", eventName: "Install", cacRate: "1", eventCount: "1" }, 1)], ctx(), new Set());
    expect(r.status).toBe("error");
    expect(r.messages[0]).toContain("after");
  });

  it("skips a group matching an existing partner PO", () => {
    const c = ctx({ existingKeys: new Set(["3|11|2026-01-10|2026-02-10"]) });
    const r = d.resolveGroup([row({ ...header, eventName: "Install", cacRate: "1", eventCount: "1" }, 1)], c, new Set());
    expect(r.status).toBe("skip");
  });

  it("errors on an invalid event count", () => {
    const r = d.resolveGroup([row({ ...header, eventName: "Install", cacRate: "1", eventCount: "1.5" }, 1)], ctx(), new Set());
    expect(r.status).toBe("error");
    expect(r.messages[0]).toContain("Event Count");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/web test partner-purchase-orders`
Expected: FAIL with "Cannot find module './partner-purchase-orders'".

- [ ] **Step 3: Write the columns/metadata file**

```typescript
// app/lib/import/descriptors/partner-purchase-orders.columns.ts
import type { ColumnSpec } from "../types";

export const partnerPurchaseOrdersColumns: ColumnSpec[] = [
  { key: "poReference", label: "PO Reference", required: true, aliases: ["ref", "poref", "group"], example: "PO-1", note: "Any label; groups the rows of one PO together (not stored)." },
  { key: "partnerName", label: "Partner", required: true, aliases: ["partner", "platform"], example: "Acme Media", note: "Must match an existing partner that has a PO code prefix." },
  { key: "clientPoCode", label: "Client PO Code", required: true, aliases: ["cpocode", "clientpo", "cpo"], example: "CPO-ACME-0126-0001", note: "Must match an existing client PO code." },
  { key: "startDate", label: "Start Date", required: true, aliases: ["start"], example: "2026-01-10", note: "YYYY-MM-DD." },
  { key: "endDate", label: "End Date", required: true, aliases: ["end"], example: "2026-02-10", note: "YYYY-MM-DD; on/after start date." },
  { key: "notes", label: "Notes", required: false, aliases: ["note"], example: "", note: "Optional free text (header-level)." },
  { key: "eventName", label: "Event", required: true, aliases: ["event"], example: "Install", note: "Must match an event defined on the client PO's client." },
  { key: "cacRate", label: "CAC Rate", required: true, aliases: ["cac", "rate"], example: "2.50", note: "Cost per event (number)." },
  { key: "eventCount", label: "Event Count", required: true, aliases: ["count", "events"], example: "1000", note: "Whole number of events." },
];

export const partnerPurchaseOrdersMeta = {
  type: "partner-purchase-orders",
  label: "Partner Purchase Orders",
  columns: partnerPurchaseOrdersColumns,
  sampleRows: [
    ["PO-1", "Acme Media", "CPO-ACME-0126-0001", "2026-01-10", "2026-02-10", "Q1 push", "Install", "2.50", "1000"],
    ["PO-1", "Acme Media", "CPO-ACME-0126-0001", "2026-01-10", "2026-02-10", "Q1 push", "Signup", "1.00", "500"],
    ["PO-2", "Beta Ads", "CPO-BETA-0126-0002", "2026-01-15", "2026-03-15", "", "Purchase", "5.00", "200"],
  ],
};
```

- [ ] **Step 4: Write the descriptor with `resolveGroup` (stub `loadContext`/`commit`)**

```typescript
// app/lib/import/descriptors/partner-purchase-orders.ts
import type { GroupedImportDescriptor, RowResult } from "../types";
import { normalizeName, parseDateCell } from "./cpo-helpers";
import { partnerPurchaseOrdersColumns } from "./partner-purchase-orders.columns";

export interface PpoContext {
  partnersByName: Map<string, Array<{ id: number; codePrefix: string }>>;
  cpoByCode: Map<string, { id: number; clientId: number }>;
  eventsByClientAndName: Map<string, Array<{ id: number }>>; // key: `${clientId}|${normalizedName}`
  existingKeys: Set<string>;                                 // `${partnerId}|${cpoId}|${start}|${end}`
  maxSeqByGroup: Map<string, number>;
}

export interface PpoItem { clientEventId: number; eventName: string; cacRate: number; eventCount: number; }
export interface PpoPayload {
  partnerId: number;
  prefix: string;
  clientPurchaseOrderId: number;
  startDate: string;
  endDate: string;
  notes: string | null;
  items: PpoItem[];
}

type GroupRow = { cells: Record<string, string>; rowNumber: number };

/** The single non-empty value for a header field across the group, or "" (pushes a conflict error if >1). */
function pickHeader(groupRows: GroupRow[], key: string, label: string, errors: string[]): string {
  const values = new Set(groupRows.map((r) => (r.cells[key] ?? "").trim()).filter((v) => v !== ""));
  if (values.size > 1) { errors.push(`Conflicting ${label} within this PO reference`); return ""; }
  return values.size === 1 ? [...values][0] : "";
}

function resolveGroup(groupRows: GroupRow[], ctx: PpoContext, seen: Set<string>): RowResult<PpoPayload> {
  const rowNumber = groupRows[0].rowNumber;
  const ref = groupRows[0].cells.poReference;
  const messages: string[] = [];
  const error = (msg: string): RowResult<PpoPayload> => ({ rowNumber, status: "error", messages: [msg] });

  const partnerName = pickHeader(groupRows, "partnerName", "Partner", messages);
  const clientPoCode = pickHeader(groupRows, "clientPoCode", "Client PO Code", messages);
  const startRaw = pickHeader(groupRows, "startDate", "Start Date", messages);
  const endRaw = pickHeader(groupRows, "endDate", "End Date", messages);
  const notesRaw = pickHeader(groupRows, "notes", "Notes", messages);
  if (messages.length) return { rowNumber, status: "error", messages };

  if (!partnerName) return error(`Partner is required (PO reference "${ref}")`);
  const partnerMatches = ctx.partnersByName.get(normalizeName(partnerName));
  if (!partnerMatches || partnerMatches.length === 0) return error(`Unknown partner: "${partnerName}"`);
  if (partnerMatches.length > 1) return error(`Ambiguous partner name: "${partnerName}"`);
  const partner = partnerMatches[0];
  const prefix = partner.codePrefix.trim();
  if (!prefix) return error(`Partner "${partnerName}" has no PO code prefix — set one first`);

  if (!clientPoCode) return error(`Client PO Code is required (PO reference "${ref}")`);
  const cpo = ctx.cpoByCode.get(clientPoCode.trim());
  if (!cpo) return error(`Unknown client PO code: "${clientPoCode}"`);

  const startDate = parseDateCell(startRaw, "Start Date", messages);
  const endDate = parseDateCell(endRaw, "End Date", messages);
  if (messages.length) return { rowNumber, status: "error", messages };
  if (!startDate || !endDate) return error("Start Date and End Date are required");
  if (startDate > endDate) return error("Start Date is after End Date");

  const key = `${partner.id}|${cpo.id}|${startDate}|${endDate}`;
  if (ctx.existingKeys.has(key)) return { rowNumber, status: "skip", messages: ["Duplicate of an existing partner PO for this partner, client PO & dates"] };
  if (seen.has(key)) return { rowNumber, status: "skip", messages: ["Duplicate PO in file"] };

  const items: PpoItem[] = [];
  for (const gr of groupRows) {
    const eventName = (gr.cells.eventName ?? "").trim();
    if (!eventName) return { rowNumber: gr.rowNumber, status: "error", messages: [`Event is required (row ${gr.rowNumber})`] };
    const evMatches = ctx.eventsByClientAndName.get(`${cpo.clientId}|${normalizeName(eventName)}`);
    if (!evMatches || evMatches.length === 0) return { rowNumber: gr.rowNumber, status: "error", messages: [`Unknown event "${eventName}" for this client (row ${gr.rowNumber})`] };
    if (evMatches.length > 1) return { rowNumber: gr.rowNumber, status: "error", messages: [`Ambiguous event "${eventName}" for this client (row ${gr.rowNumber})`] };
    const cacStr = (gr.cells.cacRate ?? "").trim();
    const cacRate = Number(cacStr);
    if (!cacStr || Number.isNaN(cacRate) || cacRate < 0) return { rowNumber: gr.rowNumber, status: "error", messages: [`Invalid CAC Rate "${gr.cells.cacRate}" (row ${gr.rowNumber})`] };
    const countStr = (gr.cells.eventCount ?? "").trim();
    const eventCount = Number(countStr);
    if (!countStr || !Number.isInteger(eventCount) || eventCount < 0) return { rowNumber: gr.rowNumber, status: "error", messages: [`Invalid Event Count "${gr.cells.eventCount}" (row ${gr.rowNumber})`] };
    items.push({ clientEventId: evMatches[0].id, eventName, cacRate, eventCount });
  }
  if (items.length === 0) return error("PO has no line items");

  seen.add(key);
  return {
    rowNumber,
    status: "valid",
    messages: [],
    payload: { partnerId: partner.id, prefix, clientPurchaseOrderId: cpo.id, startDate, endDate, notes: notesRaw || null, items },
  };
}

export const partnerPurchaseOrdersDescriptor: GroupedImportDescriptor<PpoContext, PpoPayload> = {
  type: "partner-purchase-orders",
  label: "Partner Purchase Orders",
  columns: partnerPurchaseOrdersColumns,
  groupBy: "poReference",
  // Implemented in Task 4:
  async loadContext(): Promise<PpoContext> {
    throw new Error("not implemented");
  },
  resolveGroup,
  async commit(): Promise<void> {
    throw new Error("not implemented");
  },
};
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @workspace/web test partner-purchase-orders`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add app/lib/import/descriptors/partner-purchase-orders.columns.ts app/lib/import/descriptors/partner-purchase-orders.ts app/lib/import/descriptors/partner-purchase-orders.test.ts
git commit -m "feat(import): partner-PO columns + grouped row resolution"
```

---

## Task 4: Partner PO `loadContext` + `commit` + registry + route test

**Files:**
- Modify: `app/lib/import/descriptors/partner-purchase-orders.ts`
- Modify: `app/lib/import/registry.ts`
- Create: `app/app/api/import/[type]/partner-route.test.ts`

- [ ] **Step 1: Add imports + implement `loadContext`/`commit`**

At the top of `app/lib/import/descriptors/partner-purchase-orders.ts` add (with the existing imports):

```typescript
import {
  db, partnerPurchaseOrdersTable, partnerPurchaseOrderItemsTable,
  partnersTable, clientPurchaseOrdersTable, clientEventsTable,
} from "@workspace/db";
import { formatPoCode } from "@/lib/po-codes";
import { lineBudget, totalBudget } from "@/lib/po-totals";
import type { ImportSession } from "../types";
import { isoToLocalDate, mmyyKey } from "./cpo-helpers";
import { seedMaxSeq } from "../po-code-seq";
```

Replace the `loadContext` stub body with:

```typescript
  async loadContext(): Promise<PpoContext> {
    const partners = await db
      .select({ id: partnersTable.id, name: partnersTable.name, codePrefix: partnersTable.codePrefix })
      .from(partnersTable);
    const partnersByName = new Map<string, Array<{ id: number; codePrefix: string }>>();
    for (const p of partners) {
      const k = normalizeName(p.name);
      const list = partnersByName.get(k) ?? [];
      list.push({ id: p.id, codePrefix: p.codePrefix ?? "" });
      partnersByName.set(k, list);
    }

    const cpos = await db
      .select({ id: clientPurchaseOrdersTable.id, code: clientPurchaseOrdersTable.code, clientId: clientPurchaseOrdersTable.clientId })
      .from(clientPurchaseOrdersTable);
    const cpoByCode = new Map<string, { id: number; clientId: number }>();
    for (const c of cpos) cpoByCode.set(c.code, { id: c.id, clientId: c.clientId });

    const events = await db
      .select({ id: clientEventsTable.id, clientId: clientEventsTable.clientId, name: clientEventsTable.name })
      .from(clientEventsTable);
    const eventsByClientAndName = new Map<string, Array<{ id: number }>>();
    for (const e of events) {
      const k = `${e.clientId}|${normalizeName(e.name)}`;
      const list = eventsByClientAndName.get(k) ?? [];
      list.push({ id: e.id });
      eventsByClientAndName.set(k, list);
    }

    const existing = await db
      .select({
        code: partnerPurchaseOrdersTable.code,
        partnerId: partnerPurchaseOrdersTable.partnerId,
        clientPurchaseOrderId: partnerPurchaseOrdersTable.clientPurchaseOrderId,
        startDate: partnerPurchaseOrdersTable.startDate,
        endDate: partnerPurchaseOrdersTable.endDate,
      })
      .from(partnerPurchaseOrdersTable);
    const existingKeys = new Set<string>();
    for (const r of existing) existingKeys.add(`${r.partnerId}|${r.clientPurchaseOrderId}|${r.startDate}|${r.endDate}`);
    const maxSeqByGroup = seedMaxSeq(existing.map((r) => r.code), "PPO");

    return { partnersByName, cpoByCode, eventsByClientAndName, existingKeys, maxSeqByGroup };
  },
```

Replace the `commit` stub body with:

```typescript
  async commit(payloads: PpoPayload[], ctx: PpoContext, session: ImportSession): Promise<void> {
    const counters = new Map(ctx.maxSeqByGroup);
    await db.transaction(async (tx) => {
      for (const p of payloads) {
        const date = isoToLocalDate(p.startDate);
        const group = `${p.prefix}|${mmyyKey(date)}`;
        const next = (counters.get(group) ?? 0) + 1;
        counters.set(group, next);
        const code = "PPO-" + formatPoCode(p.prefix, date, next);
        const total = totalBudget(p.items.map((i) => ({ cacRate: i.cacRate, eventCount: i.eventCount })));
        const [ppo] = await tx.insert(partnerPurchaseOrdersTable).values({
          code,
          partnerId: p.partnerId,
          clientPurchaseOrderId: p.clientPurchaseOrderId,
          startDate: p.startDate,
          endDate: p.endDate,
          totalBudget: String(total),
          notes: p.notes,
          createdById: session.userId,
        }).returning();
        await tx.insert(partnerPurchaseOrderItemsTable).values(p.items.map((i) => ({
          partnerPurchaseOrderId: ppo.id,
          clientEventId: i.clientEventId,
          eventName: i.eventName,
          cacRate: String(i.cacRate),
          eventCount: i.eventCount,
          lineBudget: String(lineBudget(i.cacRate, i.eventCount)),
        })));
      }
    });
  },
```

- [ ] **Step 2: Register the descriptor**

Replace `app/lib/import/registry.ts` with:

```typescript
// app/lib/import/registry.ts
import type { ImportDescriptor } from "./types";
import { clientPurchaseOrdersDescriptor } from "./descriptors/client-purchase-orders";
import { partnerPurchaseOrdersDescriptor } from "./descriptors/partner-purchase-orders";

// Heterogeneous descriptors — ctx/payload types differ per entry.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const registry: Record<string, ImportDescriptor<any, any>> = {
  [clientPurchaseOrdersDescriptor.type]: clientPurchaseOrdersDescriptor,
  [partnerPurchaseOrdersDescriptor.type]: partnerPurchaseOrdersDescriptor,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getDescriptor(type: string): ImportDescriptor<any, any> | undefined {
  return registry[type];
}

/** Descriptor metadata for the UI type picker (server-only; the client uses catalog.ts). */
export function listDescriptors(): Array<{ type: string; label: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Object.values(registry).map((d: ImportDescriptor<any, any>) => ({ type: d.type, label: d.label }));
}
```

- [ ] **Step 3: Write the partner route test**

```typescript
// app/app/api/import/[type]/partner-route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const insertValues = vi.fn((..._args: any[]) => ({ returning: async () => [{ id: 99 }] }));
const transaction = vi.fn(async (cb: (tx: unknown) => Promise<void>) =>
  cb({ insert: () => ({ values: insertValues }) }),
);

const partnersTable = { __t: "partners" };
const clientPurchaseOrdersTable = { __t: "cpo" };
const clientEventsTable = { __t: "events" };
const partnerPurchaseOrdersTable = { __t: "ppo" };
const partnerPurchaseOrderItemsTable = { __t: "ppoItems" };

let data: Record<string, unknown[]> = {};

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: (t: { __t: string }) => data[t.__t] ?? [] }),
    transaction,
  },
  partnersTable, clientPurchaseOrdersTable, clientEventsTable,
  partnerPurchaseOrdersTable, partnerPurchaseOrderItemsTable,
}));

vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(async () => ({ sub: 42, name: "T", email: "t@x.com", role: "Admin", isSystem: true })),
}));

function call(type: string, body: unknown) {
  return import("./route").then(({ POST }) =>
    POST(
      new Request(`http://localhost/api/import/${type}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ type }) },
    ),
  );
}

beforeEach(() => {
  insertValues.mockClear();
  transaction.mockClear();
  data = {
    partners: [{ id: 3, name: "Acme Media", codePrefix: "ACME" }],
    cpo: [{ id: 11, code: "CPO-ACME-0126-0001", clientId: 7 }],
    events: [{ id: 21, clientId: 7, name: "Install" }, { id: 22, clientId: 7, name: "Signup" }],
    ppo: [],
  };
});

// mapping: poReference, partnerName, clientPoCode, startDate, endDate, notes, eventName, cacRate, eventCount
const MAPPING = { poReference: 0, partnerName: 1, clientPoCode: 2, startDate: 3, endDate: 4, notes: 5, eventName: 6, cacRate: 7, eventCount: 8 };
const hdr = ["PO-1", "Acme Media", "CPO-ACME-0126-0001", "2026-01-10", "2026-02-10", ""];

describe("POST /api/import/partner-purchase-orders", () => {
  it("dry-run groups two item rows into one valid PO and does not write", async () => {
    const res = await call("partner-purchase-orders", {
      mapping: MAPPING,
      rows: [[...hdr, "Install", "2.5", "1000"], [...hdr, "Signup", "1", "500"]],
      dryRun: true,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.valid).toBe(1);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("commit inserts one partner PO (PPO- code) and its two items", async () => {
    const res = await call("partner-purchase-orders", {
      mapping: MAPPING,
      rows: [[...hdr, "Install", "2.5", "1000"], [...hdr, "Signup", "1", "500"]],
      dryRun: false,
    });
    expect(res.status).toBe(200);
    expect(transaction).toHaveBeenCalledTimes(1);
    // 1st insert = the PO, 2nd = the items array
    const poInsert = insertValues.mock.calls[0][0];
    expect(poInsert).toMatchObject({ partnerId: 3, clientPurchaseOrderId: 11, createdById: 42 });
    expect(poInsert.code).toMatch(/^PPO-ACME-\d{4}-0001$/);
    expect(String(poInsert.totalBudget)).toBe("3000"); // 2.5*1000 + 1*500
    const itemsInsert = insertValues.mock.calls[1][0];
    expect(itemsInsert).toHaveLength(2);
    expect(itemsInsert[0]).toMatchObject({ partnerPurchaseOrderId: 99, clientEventId: 21 });
  });
});
```

- [ ] **Step 4: Run tests + typecheck + build**

Run: `pnpm --filter @workspace/web test partner`
Expected: PASS (resolveGroup suite + partner route suite).
Run: `pnpm --filter @workspace/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/lib/import/descriptors/partner-purchase-orders.ts app/lib/import/registry.ts app/app/api/import/[type]/partner-route.test.ts
git commit -m "feat(import): partner-PO loadContext/commit + registry + route test"
```

---

## Task 5: Catalog + sample UI on the importer page

**Files:**
- Create: `app/lib/import/catalog.ts`
- Modify: `app/lib/import/descriptors/client-purchase-orders.columns.ts`
- Modify: `app/app/(dashboard)/upload/page.tsx`

- [ ] **Step 1: Add `note`s + `sampleRows` to the Client PO metadata**

Replace `app/lib/import/descriptors/client-purchase-orders.columns.ts` with:

```typescript
// app/lib/import/descriptors/client-purchase-orders.columns.ts
import type { ColumnSpec } from "../types";

export const clientPurchaseOrdersColumns: ColumnSpec[] = [
  { key: "clientName", label: "Client Name", required: true, aliases: ["client"], example: "Acme Corp", note: "Must match an existing client that has a PO code prefix." },
  { key: "receiveDate", label: "Receive Date", required: false, aliases: ["received", "podate"], example: "2026-01-05", note: "YYYY-MM-DD; when the PO was received." },
  { key: "startDate", label: "Start Date", required: false, aliases: ["campaignstart"], example: "2026-01-10", note: "YYYY-MM-DD." },
  { key: "endDate", label: "End Date", required: false, aliases: ["campaignend"], example: "2026-02-10", note: "YYYY-MM-DD; on/after start date." },
];

export const clientPurchaseOrdersMeta = {
  type: "client-purchase-orders",
  label: "Client Purchase Orders",
  columns: clientPurchaseOrdersColumns,
  sampleRows: [
    ["Acme Corp", "2026-01-05", "2026-01-10", "2026-02-10"],
    ["Beta LLC", "2026-01-08", "2026-01-15", "2026-03-15"],
  ],
};
```

- [ ] **Step 2: Create the client-safe catalog**

```typescript
// app/lib/import/catalog.ts  — client-safe: no DB imports
import type { ColumnSpec } from "./types";
import { clientPurchaseOrdersMeta } from "./descriptors/client-purchase-orders.columns";
import { partnerPurchaseOrdersMeta } from "./descriptors/partner-purchase-orders.columns";

export interface CatalogEntry {
  type: string;
  label: string;
  columns: ColumnSpec[];
  sampleRows: string[][];
}

export const importCatalog: CatalogEntry[] = [clientPurchaseOrdersMeta, partnerPurchaseOrdersMeta];

export function getCatalogEntry(type: string): CatalogEntry | undefined {
  return importCatalog.find((e) => e.type === type);
}
```

- [ ] **Step 3: Replace the importer page (multi-type + sample view + sample CSV)**

Replace `app/app/(dashboard)/upload/page.tsx` with:

```tsx
// app/app/(dashboard)/upload/page.tsx
"use client";

import { useCallback, useMemo, useState } from "react";
import { Upload, FileText, CheckCircle, XCircle, AlertCircle, Download } from "lucide-react";
import {
  useRunImport,
  getListClientPurchaseOrdersQueryKey,
  getListPartnerPurchaseOrdersQueryKey,
} from "@workspace/api-client-react";
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
import { importCatalog, getCatalogEntry } from "@/lib/import/catalog";

// Which list query to refresh after a successful import, per type.
const listKeyByType: Record<string, () => readonly unknown[]> = {
  "client-purchase-orders": getListClientPurchaseOrdersQueryKey,
  "partner-purchase-orders": getListPartnerPurchaseOrdersQueryKey,
};

export default function ImportPage() {
  const [importType, setImportType] = useState(importCatalog[0].type);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const entry = getCatalogEntry(importType)!;
  const columns = entry.columns;

  const missingRequired = useMemo(
    () => columns.filter((c) => c.required && mapping[c.key] == null).map((c) => c.label),
    [columns, mapping],
  );

  const runImportMutation = useRunImport({
    mutation: { onError: () => toast({ title: "Import failed", variant: "destructive" }) },
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
      { type: importType, data: { mapping, rows, dryRun: true } },
      { onSuccess: (data: ImportResult) => {
          setPreview(data);
          if (data.fileErrors.length) toast({ title: data.fileErrors.join("; "), variant: "destructive" });
        } },
    );
  };

  const runCommit = () => {
    runImportMutation.mutate(
      { type: importType, data: { mapping, rows, dryRun: false } },
      { onSuccess: (data: ImportResult) => {
          setResult(data);
          const keyFn = listKeyByType[importType];
          if (keyFn) qc.invalidateQueries({ queryKey: keyFn() });
        } },
    );
  };

  const downloadSample = () => {
    const csv = Papa.unparse([columns.map((c) => c.label), ...entry.sampleRows]);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${importType}-sample.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const downloadErrors = (res: ImportResult) => {
    const bad = res.rows.filter((r) => r.status !== "valid");
    const csv = Papa.unparse([["row", "status", "messages"], ...bad.map((r) => [r.rowNumber, r.status, r.messages.join(" | ")])]);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${importType}-errors.csv`; a.click();
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
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={downloadSample}>
            <Download className="h-3.5 w-3.5" /> Download sample CSV
          </Button>
        </div>

        {/* Type selector */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <label className="text-sm font-semibold text-foreground">Data type</label>
          <Select value={importType} onValueChange={(v) => { setImportType(v); reset(); }}>
            <SelectTrigger className="mt-2 w-72 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {importCatalog.map((d) => (
                <SelectItem key={d.type} value={d.type}>{d.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Expected columns */}
        <div className="rounded-2xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-sm font-semibold text-foreground">Expected columns</h2>
            <p className="text-xs text-muted-foreground">Your CSV/TSV should include these columns (any header order; names are auto-matched).</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Column</th>
                  <th className="px-4 py-2 font-medium">Required</th>
                  <th className="px-4 py-2 font-medium">Example</th>
                  <th className="px-4 py-2 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {columns.map((c) => (
                  <tr key={c.key} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 font-medium text-foreground">{c.label}</td>
                    <td className="px-4 py-2">{c.required ? <span className="text-red-500">Required</span> : <span className="text-muted-foreground">Optional</span>}</td>
                    <td className="px-4 py-2 text-muted-foreground">{c.example || "—"}</td>
                    <td className="px-4 py-2 text-muted-foreground">{c.note ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }}
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
                {runImportMutation.isPending ? "Importing…" : `Import ${preview.valid} valid`}
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

- [ ] **Step 4: Typecheck + build**

Run: `pnpm --filter @workspace/web typecheck`
Expected: PASS.
Run: `pnpm --filter @workspace/web build`
Expected: PASS — `/upload` compiles with no server-only/"module not found" error (the page imports only DB-free modules: `parse`, `map-columns`, `catalog`). If the build fails ONLY due to a missing env var (e.g. `DATABASE_URL`) unrelated to our imports, note it and rely on typecheck; if it fails with a server-only/module-not-found error mentioning our import chain, STOP and report it.

- [ ] **Step 5: Commit**

```bash
git add app/lib/import/catalog.ts app/lib/import/descriptors/client-purchase-orders.columns.ts "app/app/(dashboard)/upload/page.tsx"
git commit -m "feat(import): multi-type picker, expected-columns view, sample CSV"
```

---

## Task 6: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Typecheck (app + libs)**

Run: `pnpm --filter @workspace/web typecheck`
Expected: PASS.
Run: `pnpm -w run typecheck:libs`
Expected: PASS.

- [ ] **Step 2: Full app test suite**

Run: `pnpm --filter @workspace/web test`
Expected: PASS — all prior tests plus the new grouped-engine, po-code-seq, partner-descriptor, and partner-route tests.

- [ ] **Step 3: Build**

Run: `pnpm --filter @workspace/web build`
Expected: PASS (client bundle DB-free).

- [ ] **Step 4: End-to-end dogfood (manual, needs login + DB)**

Against the running app, as a user with "Upload Data":
- Select **Partner Purchase Orders**; confirm the "Expected columns" table lists the 9 columns and "Download sample CSV" produces a file whose first two rows share `PO-1`.
- Import that sample against a real partner (with a `codePrefix`) and a real client PO code whose client has matching events → the two `PO-1` rows create **one** partner PO with **two** line items and a `PPO-…` code; the second (`PO-2`) creates another.
- Re-import the same file → the POs show as **skipped**.
- Switch back to **Client Purchase Orders**; confirm its sample view + sample CSV also render.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "test(import): phase 2 verification fixes"
```

---

## Self-review notes (for the implementer)

- **Phase 1 stays untouched:** `client-purchase-orders.ts`, `cpo-helpers.ts`, and their tests are not edited (only the *columns* file gains `note`/`sampleRows`). The `ImportDescriptor` union keeps the client-PO descriptor assignable via its `Flat` member.
- **Generated hooks:** the page uses `getListPartnerPurchaseOrdersQueryKey` (confirmed present in `lib/api-client-react/src/generated/api.ts`) and `useRunImport`. No codegen/spec change is needed — the generic `/api/import/{type}` route already handles any registered type.
- **Code date basis:** partner-PO codes use `startDate`'s `MMYY` (always present), mirroring how client-PO codes use `receiveDate`; sequencing continues from existing `PPO-` codes via the tagged `seedMaxSeq`.
- **Budgets:** never imported — `lineBudget`/`totalBudget` from `@/lib/po-totals`, matching the existing manual partner-PO route.
