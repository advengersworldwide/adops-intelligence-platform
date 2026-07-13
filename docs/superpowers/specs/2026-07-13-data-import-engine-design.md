# Data Import Engine — Design

**Date:** 2026-07-13
**Status:** Phase 1 designed and approved (pending written-spec review)
**Scope of this spec:** The reusable import engine + the first importer (Client Purchase Orders). Later phases are captured as roadmap context only.

---

## 1. Context & problem

The platform's operational data lives in a set of interconnected tables — client/partner purchase orders, client/partner billing, client/partner payments. Today every row is entered **one at a time** through create dialogs (e.g. the "Add Record" dialog on the Transactions page). There is no import path.

An older `/upload` page + `/api/upload` route exist, but they target a **defunct** `campaigns`/`transactions` model (columns `date, campaign, spend, cost`) that the platform has moved away from. They are effectively dead relative to the current data model.

The user wants a **bulk-upload capability** covering three data types, each on both the client and partner side:

| Side | Purchase Order | Billing | Payments |
|------|----------------|---------|----------|
| **Client** | `client_purchase_orders` | `billings` (+ lines, event items) | `payments` (+ allocations) |
| **Partner** | `partner_purchase_orders` (+ line items) | `partner_bills` | `partner_payments` |

**Purpose (confirmed):** *both* a one-time historical migration (existing data in spreadsheets) **and** an ongoing, repeatable per-period workflow. So this must be a real, reusable importer — not a throwaway script.

---

## 2. Goals & non-goals

**Goals**
- A reusable, config-driven import pipeline: upload → parse → map columns → validate + resolve → preview → commit → result.
- Ship the **Client Purchase Order** importer on that pipeline (Phase 1).
- Safe, idempotent re-runs (dedup) and clear per-row feedback.
- Adding each later data type = write one *descriptor* + enable a menu entry, **no new pipeline**.

**Non-goals (Phase 1)**
- Partner POs, billing, payments (Phases 2–4).
- `.xlsx` parsing (CSV/TSV only for now).
- Uploading PO document attachments during import.
- Auto-generating codes for blank cells / an "update existing" re-import mode.

---

## 3. Decomposition & roadmap

A **shared Import Engine**, then one importer per data type, built in **dependency order** (each phase's data references entities/records from earlier phases, which is required for migration to load at all):

| Phase | Delivers | Rationale |
|-------|----------|-----------|
| **1** *(this spec)* | Import Engine + **Client POs** | Everything references client POs; simplest flat type — proves the engine. |
| **2** | **Partner POs** (+ per-event line items) | References a client PO; introduces line-item handling. |
| **3** | **Client + Partner Billing** | Historical summary rows referencing POs. |
| **4** | **Client + Partner Payments** | Allocated against bills; last in the chain. |

**Scope assumption for Phases 3–4:** billing/payment import means loading **historical summary rows as-is** (for migration), *not* re-deriving invoices from pin data. In-app billing generation stays a separate flow. To be confirmed when those phases are designed.

---

## 4. Confirmed decisions (from brainstorming)

1. **Reference entities already exist.** Clients, partners, buying houses, cost models are already in the platform. The importer resolves them **by name/code** and **rejects** rows referencing an unknown entity (no auto-create).
2. **PO attachments: metadata now, attach later.** Import PO rows without a document; users attach the PDF afterward in the existing PO dialog.
3. **PO codes are auto-generated**, never taken from the file — so sequence/order stay consistent with in-app creation. (See §7.)
4. **Dedup by `(clientId, receiveDate, startDate, endDate)`** for client POs — a matching existing PO → skip and report. Rows with no dates at all skip dedup (treated as create).
5. **CSV/TSV only** for Phase 1 (`papaparse` is already a dependency).
6. **Spec-first API.** New endpoints go into the OpenAPI spec; the zod schemas + react-query hooks are regenerated via orval (matching the rest of the codebase).

---

## 5. Architecture — the engine

New module tree under **`app/lib/import/`** (colocated with the Next.js app, which is where routes + UI live and where `@workspace/db` is imported):

```
app/lib/import/
  types.ts                       # ImportDescriptor, ColumnSpec, RowResult, ImportResult
  parse.ts                       # file text → { headers, rows: string[][] } via papaparse
  map-columns.ts                 # auto-map file headers → descriptor columns (+ manual override)
  run-import.ts                  # core: validate + resolve + dedup (dry-run) and commit
  registry.ts                    # type string → descriptor
  descriptors/
    client-purchase-orders.ts    # Phase 1 descriptor
```

### Key types (shape, not final code)

```ts
interface ColumnSpec {
  key: string;          // canonical field, e.g. "clientName"
  label: string;        // template header + mapping UI label
  required: boolean;
  aliases: string[];    // header variants for auto-mapping
  example?: string;     // used to build the downloadable template
}

type RowStatus = "valid" | "skip" | "error";

interface RowResult<TPayload = unknown> {
  rowNumber: number;    // 1-based source row (excludes header)
  status: RowStatus;
  messages: string[];   // human-readable errors / skip reasons
  payload?: TPayload;   // resolved insert payload when status === "valid"
}

interface ImportDescriptor<TPayload> {
  type: string;                 // "client-purchase-orders"
  label: string;
  columns: ColumnSpec[];
  rowSchema: ZodType;           // validates a mapped raw row (strings → typed)
  loadContext(rows): Promise<Ctx>;               // batch-load lookups (clients, existing POs…)
  resolveRow(raw, ctx, seenKeys): RowResult<TPayload>;  // parse + resolve FKs + dedup
  commit(payloads, ctx, tx): Promise<CommitStats>;      // insert inside a transaction
}

interface ImportResult {
  total: number;
  valid: number;
  skipped: number;
  errored: number;
  rows: RowResult[];    // annotated, for preview / error report
}
```

The engine is generic; each data type supplies a descriptor. Phases 2–4 add descriptors to `descriptors/` and register them in `registry.ts`.

---

## 6. Data flow

Two server round-trips: **dry-run** (preview) then **commit**. FK resolution and dedup hit the DB, so preview must come from a real server dry-run, not a client-side guess.

```
Client (browser)                              Server  POST /api/import/{type}
────────────────                              ──────────────────────────────
pick data type
download template (optional)
drop CSV → papaparse → { headers, rows }
auto-map columns (editable)
      │  POST { mapping, rows, dryRun:true } ─▶ loadContext → resolveRow×N
      │  ◀── ImportResult (annotated rows)      (no writes)
render preview table (valid / skip / error, counts, filter-to-errors)
click "Import N valid rows"
      │  POST { mapping, rows, dryRun:false }─▶ re-resolve → commit valid rows in a txn
      │  ◀── ImportResult (final)               (auto-gen codes, insert)
show result cards + downloadable error CSV
```

- **Row cap:** ~5,000 rows per import for Phase 1 (larger files → ask user to split; streaming is a later enhancement).
- Commit inserts the valid subset inside **one transaction** (all-or-nothing for the valid rows). Rows that errored or were skipped are never part of the transaction; they're reported.

---

## 7. Client PO descriptor (Phase 1)

### Spreadsheet columns

| Column | Required | Type | Notes |
|--------|----------|------|-------|
| `clientName` | ✅ | string | Resolved to `clientId` by exact (normalized) name match. Unknown or ambiguous → **row error**. |
| `receiveDate` | — | `YYYY-MM-DD` | Date the PO was received. |
| `startDate` | — | `YYYY-MM-DD` | Campaign start. |
| `endDate` | — | `YYYY-MM-DD` | Campaign end; if both present, must satisfy `startDate ≤ endDate`. |

No `code` column — codes are generated (below). No attachment column — attachments are inserted empty.

### Client resolution
- `loadContext` preloads all clients into a `Map<normalizedName, Client[]>`.
- Exact normalized-name match → resolve `clientId` **and** `codePrefix`.
- No match → row error "Unknown client: '<name>'".
- Multiple matches → row error "Ambiguous client name: '<name>' matches N clients".
- Client has no `codePrefix` → row error "Client '<name>' has no PO code prefix — set one first" (mirrors `nextCpoCode`, which throws in that case).

### Code generation
- Format: `CPO-<prefix>-MMYY-NNNN` via the existing `formatPoCode(prefix, date, seq)`.
- **`MMYY` basis:** the row's `receiveDate` if present, else today. (Keeps historical migrated codes meaningful and ordered instead of stamping everything with the current month.)
- **Sequence (`NNNN`):** per `(prefix, MMYY)`. Computed at commit time by counting existing codes matching `CPO-<prefix>-MMYY-%` in the DB, then incrementing a **per-key counter within the batch** so multiple rows in the same import never collide on `0001`. Done inside the commit transaction to avoid races.

### Dedup (skip)
- Natural key: `(clientId, receiveDate, startDate, endDate)`.
- If an existing `client_purchase_orders` row matches the key → status `skip`, message "Duplicate of existing PO for this client & dates".
- In-file duplicates (two rows, same key) → the second is `skip` "Duplicate row in file".
- Rows with all three dates null → dedup does not apply → treated as create.

### Attachments
- Insert `attachmentUrl: ""`, `attachmentName: null`, `attachments: []`.
- Empty string satisfies the `attachment_url NOT NULL` column, and `mapCpoRow` already renders an empty/absent `attachmentUrl` as "no attachments" (`r.attachmentUrl ? [...] : []`). **No schema migration required.**

### Insert payload (per valid row)
```
{ code (generated), clientId, attachmentUrl: "", attachmentName: null,
  attachments: [], receiveDate|null, startDate|null, endDate|null,
  createdById: session user id }
```

---

## 8. API surface + code generation

- **Endpoint:** `POST /api/import/{type}` where `{type}` ∈ registry (Phase 1: `client-purchase-orders`).
  - Body: `{ mapping: Record<string,string>, rows: string[][], dryRun: boolean }`.
  - Response: `ImportResult`.
  - Runtime: `nodejs`. Gated by the **"Upload Data"** permission (server-side session check, mirroring existing routes).
- **Spec-first:** add the endpoint + `ImportResult` / request-body schemas to the OpenAPI spec (`lib/api-spec`), regenerate `@workspace/api-zod` and `@workspace/api-client-react` via orval, and implement the route with the engine.
- The generated react-query hook (e.g. `useRunImport`) drives the page.

---

## 9. UI/UX

New page at **`app/app/(dashboard)/upload/page.tsx`** (reusing the `/upload` route; legacy contents replaced — see §12). Wrapped in `PermissionGuard permission="Upload Data"`.

Steps (single page, progressive):
1. **Type selector** — Phase 1 enables only "Client Purchase Orders"; other types shown disabled with a "coming soon" tag.
2. **Template + drop zone** — "Download CSV template" (built from the descriptor's `columns` + `example`) and the existing drag-and-drop zone (reused from the legacy page). CSV/TSV accepted.
3. **Column mapping** — auto-mapped header→column dropdowns, editable; only surfaced if headers don't cleanly match the template. Missing a required column blocks preview with a clear message.
4. **Preview** — per-row status table (valid / skip / error) with counts and a "show errors only" filter. Reuses existing table styling.
5. **Result** — imported / skipped / failed cards (reusing the legacy result UI) + a "Download error report" CSV of the non-valid rows with their messages.

Reused building blocks: drop zone + `papaparse` (from legacy page), `useToast`, table/card styling, `PermissionGuard`.

---

## 10. Error handling & edge cases

| Case | Behavior |
|------|----------|
| Empty file / no data rows | Block, toast "File has no data rows". |
| Missing required column after mapping | Block preview, name the missing column(s). |
| Unknown / ambiguous client | Row error (see §7). |
| Client without `codePrefix` | Row error. |
| Bad date format | Row error naming the column. |
| `startDate > endDate` | Row error. |
| Existing PO (dedup key match) | Row `skip`. |
| In-file duplicate | Second row `skip`. |
| > row cap | Block, ask to split the file. |
| Commit transaction failure | Nothing inserted; result reports the failure; user can retry. |

---

## 11. Testing

- **Unit** (`app/lib/import/`): CSV/TSV parse; header auto-mapping incl. aliases; per-row validation; client resolution (match / unknown / ambiguous / no-prefix); date validation + `start ≤ end`; dedup (DB match, in-file dup, all-null-dates); code generation incl. batch sequencing + `MMYY`-from-`receiveDate`; empty-attachment payload.
- **Route** (`app/app/api/import/client-purchase-orders/route.test.ts`, following existing `route.test.ts` patterns): dry-run returns correct per-row statuses without writing; commit inserts valid rows, skips duplicates, and generates non-colliding sequential codes.

---

## 12. Out of scope / to confirm at review

- **Legacy `/upload` replacement.** The current `/upload` page and `/api/upload` route (campaigns/transactions model) become dead once this ships. Proposal: replace the page contents and **remove** the old `/api/upload` route + its `useUploadData` usage. → *Confirm deletion at review.*
- **`.xlsx` support** — deferred; CSV/TSV only in Phase 1.
- **Attachment upload during import** — deferred (metadata-now approach).
- **"Update existing" re-import mode** — deferred; Phase 1 skips duplicates only.
- **Auto-generating codes for future ongoing POs vs. preserving history** — codes always generated; the `MMYY`-from-`receiveDate` default keeps history sane.

---

## 13. Open questions for the reviewer

1. §12 — OK to delete the legacy `/api/upload` route and `useUploadData` hook, or keep them around?
2. §5 — engine under `app/lib/import/` (colocated) vs. a new `@workspace/import` package. Colocated is simpler for Phase 1; a package is cleaner if we expect heavy reuse. Defaulting to colocated.
3. §9 — reuse the `/upload` route/path, or introduce a new `/import` route in the dashboard nav?