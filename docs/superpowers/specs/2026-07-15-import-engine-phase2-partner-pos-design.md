# Import Engine — Phase 2 (Partner POs + Sample View) Design

**Date:** 2026-07-15
**Status:** Designed and approved (pending written-spec review)
**Builds on:** `docs/superpowers/specs/2026-07-13-data-import-engine-design.md` (Phase 1, shipped)

---

## 1. Context

Phase 1 shipped a config-driven import engine (`app/lib/import/`) and the **Client PO** importer on it. Phase 2 adds the next data type in the dependency-ordered roadmap — **Partner POs** — plus a shared UX improvement (a sample columns view + a richer sample CSV) that every importer inherits.

Partner POs differ structurally from client POs: a partner PO is a **header + N line items** (one per event). A flat CSV represents that as multiple rows grouped into one PO — a capability the engine does not have yet.

Partner PO model (from the schema + the existing `POST /api/partner-purchase-orders` route):
- `partner_purchase_orders`: unique `code` (auto-generated `PPO-<prefix>-MMYY-NNNN`, needs the partner's `codePrefix`), `partnerId`, `clientPurchaseOrderId` (**references a client PO**, which resolves the client), `startDate`/`endDate` (NOT NULL), `totalBudget`, `notes`.
- `partner_purchase_order_items`: `clientEventId` (references `client_events`), `eventName`, `cacRate`, `eventCount`, `lineBudget`.
- `totalBudget` and each `lineBudget` are **computed** (`@/lib/po-totals`: `lineBudget = cacRate × eventCount`, `totalBudget = Σ lineBudget`), never entered.
- Events are per-client (`client_events.clientId`, `.name`), so an item's `clientEventId` is resolved by matching `eventName` **within the client** that owns the referenced client PO.

---

## 2. Goals & non-goals

**Goals**
- **A. Shared sample UX:** an on-page "Expected columns" table + a "Download sample CSV" with a few realistic rows, driven by importer metadata — so all importers (incl. Phase 1's Client PO) get it.
- **B. Grouped-import capability** in the engine (many rows → one record with children), with Phase 1's flat importer untouched.
- **C. Partner PO importer** built on B, registered and enabled in the page's type picker.

**Non-goals**
- Client/partner billing, payments (Phases 3–4).
- `.xlsx` parsing; attachment upload; "update existing" re-import mode (still deferred).
- Any change to the generic `POST /api/import/{type}` route (a new descriptor needs no route change).

---

## 3. Confirmed decisions

1. **Line items = row-per-item + a `poReference` column.** One row per event line item; a user-assigned `poReference` label groups an PO's rows (in-file only). Chosen over auto-grouping (ambiguous) and single-cell encoding (error-prone to author).
2. **Header fields are per-group, taken from the first row that supplies them.** If a later row in the same group supplies a *conflicting* non-empty header value → group error.
3. **Grouped support via a discriminated descriptor** (Approach A): flat importers keep `resolveRow`; grouped importers declare `groupBy` + `resolveGroup`. `runImport` branches on the presence of `groupBy`. Phase 1 code/tests are untouched.
4. **Dedup** a partner PO group by `(partnerId, clientPurchaseOrderId, startDate, endDate)` → skip.
5. **`totalBudget`/`lineBudget` are computed** via `@/lib/po-totals`, not imported.
6. **Codes** auto-generated `PPO-<prefix>-MMYY-NNNN`, sequenced per `(prefix, MMYY)` continuing from existing DB codes — the same batch-sequencing logic as client POs, generalized to the `PPO-` tag.

---

## 4. Shared sample view + sample CSV (Goal A)

**Metadata changes (client-safe, in the `*.columns.ts` files + `types.ts`):**
- `ColumnSpec` gains an optional `note?: string` — a one-line "what goes here".
- Each importer's metadata object (`clientPurchaseOrdersMeta`, and the new partner meta) gains `sampleRows: string[][]` — a few realistic example data rows aligned to `columns` order.

**Page changes (shared `/upload` page, so every type benefits):**
- **"Expected columns" card:** a table rendered from the selected type's `columns` — one row per column showing **Label**, a **Required** badge, **Example**, and **Note**. Rendered before/near the drop zone.
- **"Download sample CSV"** replaces the current one-row template button. It emits a CSV of the column labels (header) + `sampleRows`. For **Partner POs**, `sampleRows` contains **two item-rows sharing one `poReference`** (= one PO with two line items) so the grouping is self-evident; optionally a second PO to show multiplicity.

Retroactive: Client PO's metadata gets `note`s + a 2–3 row `sampleRows`, so Phase 1's importer immediately shows the new card and sample CSV.

---

## 5. Engine: grouped-import capability (Goal B)

Extend `app/lib/import/types.ts` with a discriminated descriptor union:

```ts
// Existing (Phase 1), unchanged:
interface FlatImportDescriptor<TCtx, TPayload> {
  type: string; label: string; columns: ColumnSpec[];
  loadContext(): Promise<TCtx>;
  resolveRow(cells, rowNumber, ctx, seen): RowResult<TPayload>;
  commit(payloads: TPayload[], ctx, session): Promise<void>;
}

// New:
interface GroupedImportDescriptor<TCtx, TPayload> {
  type: string; label: string; columns: ColumnSpec[];
  groupBy: string;                    // a column key; must be a required column
  loadContext(): Promise<TCtx>;
  resolveGroup(
    groupRows: Array<{ cells: Record<string,string>; rowNumber: number }>,
    ctx: TCtx,
    seen: Set<string>,
  ): RowResult<TPayload>;
  commit(payloads: TPayload[], ctx, session): Promise<void>;
}

type ImportDescriptor<TCtx, TPayload> =
  | FlatImportDescriptor<TCtx, TPayload>
  | GroupedImportDescriptor<TCtx, TPayload>;
```

`run-import.ts`:
- After the existing file-level guards, if the descriptor has `groupBy`:
  - Rows whose `groupBy` cell is **empty** → each becomes an `error` RowResult (`"<groupBy label> is required"`).
  - Remaining rows are grouped by their `groupBy` cell value, in **first-appearance order**. Each group calls `descriptor.resolveGroup(groupRows, ctx, seen)`; the returned `RowResult.rowNumber` is the group's **first** source row (its status/messages describe the whole group).
- Otherwise, the per-row `resolveRow` path is exactly as today.
- Dry-run vs commit gating, counts, and the `EngineResult`/`ImportResult` shape are unchanged. In grouped mode, `total`/`valid`/`skipped`/`errored` count **groups** (plus any empty-key error rows), and each preview line represents one PO group.

`ImportResult` needs no schema change — the response is still per-result-line `{ rowNumber, status, messages }`.

---

## 6. Partner PO descriptor (Goal C)

New files under `app/lib/import/descriptors/`:
- `partner-purchase-orders.columns.ts` — client-safe columns + `partnerPurchaseOrdersMeta` (incl. `note`s + `sampleRows`).
- `partner-purchase-orders.ts` — the `GroupedImportDescriptor` (`groupBy: "poReference"`).

**CSV columns** (header fields per-group, item fields per-row):

| Column | Scope | Required | Resolves / notes |
|--------|-------|----------|------------------|
| `poReference` | group key | ✅ | Any label; groups an PO's rows (in-file only, not stored) |
| `partnerName` | header | ✅ | → partner by name; partner must have a `codePrefix` |
| `clientPoCode` | header | ✅ | → `clientPurchaseOrderId` + owning client, by CPO `code` |
| `startDate` | header | ✅ | `YYYY-MM-DD` |
| `endDate` | header | ✅ | `YYYY-MM-DD`; `startDate ≤ endDate` |
| `notes` | header | — | optional |
| `eventName` | item | ✅ | → `clientEventId` by event name **within the CPO's client** |
| `cacRate` | item | ✅ | number ≥ 0 |
| `eventCount` | item | ✅ | integer ≥ 0 |

**`loadContext`** preloads: partners by normalized name (`{id, codePrefix}`); client POs by `code` (`{id, clientId}`); client events keyed by `${clientId}|${normalizedName}` (`{id}`); existing partner-PO dedup keys `(partnerId, cpoId, startDate, endDate)`; and `maxSeqByGroup` seeded from existing `PPO-` codes.

**`resolveGroup`** for one group:
- Derive header fields from the first row supplying each; a conflicting non-empty value in another row of the group → error (`"conflicting <field> within PO reference '<ref>'"`).
- Resolve `partnerName` → partner (unknown/ambiguous → error; empty `codePrefix` → error `"partner has no PO code prefix"`).
- Resolve `clientPoCode` → `clientPurchaseOrderId` + `clientId` (unknown → error).
- Validate dates (present, valid, `start ≤ end`).
- Dedup on `(partnerId, clientPurchaseOrderId, startDate, endDate)`: matches existing → skip; in-file duplicate (via `seen`) → skip.
- Items: for each row, resolve `eventName` → `clientEventId` within the client (unknown/ambiguous → error), parse `cacRate` (number) and `eventCount` (int). A group must yield **≥ 1** valid item.
- Payload: `{ partnerId, prefix, clientPurchaseOrderId, startDate, endDate, notes|null, items: [{ clientEventId, eventName, cacRate, eventCount }] }`.

**`commit`** (one transaction): for each group payload, generate the `PPO-` code (batch-sequenced like Client PO), insert the partner PO with **computed** `totalBudget`, then insert its items with **computed** `lineBudget` — reusing `@/lib/po-totals`.

**Code sequencing helper:** the `MMYY` + per-`(prefix,MMYY)` batch sequencing built for Client PO is generalized to a tag parameter so both `CPO-` and `PPO-` share it (extract a small tagged helper; keep Phase 1's `parseCpoCode`/`seedMaxSeq` names working so existing tests are unaffected).

**Registry + page:** register `partnerPurchaseOrdersDescriptor` in `registry.ts`; add `partnerPurchaseOrdersMeta` to the page's type list so "Partner Purchase Orders" becomes a selectable type. The type picker becomes genuinely functional (two enabled types); selecting a type swaps the columns/sample/mapping. The generic route is unchanged.

---

## 7. Error handling & edge cases

Empty `poReference` → per-row error. Conflicting header within a group → group error. Unknown/ambiguous partner, unknown CPO code, unknown/ambiguous event, partner without `codePrefix`, bad date, `start > end`, group with zero valid items → group error. Existing partner PO (dedup) or in-file duplicate group → skip. Commit wraps PO + items in one transaction (a group is all-or-nothing).

---

## 8. Testing

- **Unit:** grouped `run-import` (grouping order, empty-key errors, per-group resolve, dry-run vs commit); `partner-purchase-orders` `resolveGroup` (header consistency + conflict, partner/CPO/event resolution incl. unknown/ambiguous, dedup existing + in-file, `start>end`, zero-item group, computed line/total budgets); the tagged code-sequencing helper; the sample-CSV builder.
- **Route:** `POST /api/import/partner-purchase-orders` dry-run (statuses, no writes) and commit (inserts one partner PO + N items, `PPO-…` code, computed budgets) with mocked db + session.

---

## 9. Out of scope / deferred

Billing & payments importers (Phases 3–4) · `.xlsx` · attachment upload · "update existing" mode · fill-down of header cells across an unordered group beyond the first-supplied-wins rule.
