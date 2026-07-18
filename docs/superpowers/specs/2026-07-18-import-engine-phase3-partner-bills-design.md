# Import Engine — Phase 3 (Partner Bills) Design

**Date:** 2026-07-18
**Status:** Designed and approved (pending written-spec review)
**Builds on shipped:** Phase 1 (`docs/superpowers/specs/2026-07-13-data-import-engine-design.md`), Phase 2 (`docs/superpowers/specs/2026-07-15-import-engine-phase2-partner-pos-design.md`)

---

## 1. Context

The roadmap's next data type is billing. Exploring the model surfaced a large asymmetry:

- **Partner bills** (`partner_bills`) are **simple flat records**: `partnerId`, optional `clientId`/`partnerPurchaseOrderId`, an `amount` stored directly (USD), `partnerInvoiceNumber`, `dateReceived`, optional attachment, `notes`, and an auto-generated `code` (`PBILL-<prefix>-MMYY-NNNN`). These are the external invoices the business *receives* from partners — exactly what a migration wants to bulk-load.
- **Client billing** (`billings` + `billing_lines` + `billing_event_items`) is a **generated, nested invoice**: a header (client + client PO + period + forex + tax snapshots + status + invoice code) → lines per partner → event items carrying rate snapshots (`billableRate`, `payoutRate`, `eventCount`). Its amounts (`totalInvoice`, `netReceivable`, `netMargin`) are **not stored** — they're computed by `computeBilling`. It is derived from the partner POs + client rates + tax settings, not raw data.

Because client billing is derived (and, post-Phase-2, its inputs — partner POs — are already importable), reconstructing it from a flat spreadsheet would re-type data the app already computes. **Decision:** Phase 3 delivers the **Partner Bills** importer only; client billing is deferred to its own phase where we decide generate-in-app vs. import.

This phase needs **no engine or route changes** — partner bills are a flat importer that plugs into the Phase-1 flat descriptor pattern and the Phase-2 catalog/page machinery.

---

## 2. Goals & non-goals

**Goals**
- A **Partner Bills** flat importer, registered and selectable in the `/upload` type picker (inheriting the Expected-columns view + sample CSV automatically).

**Non-goals**
- Client billing import/generation (separate later phase).
- Any change to the engine (`types.ts`, `run-import.ts`), the generic `/api/import/{type}` route, or the OpenAPI spec.
- Attachment upload during import; `.xlsx`; "update existing" mode (still deferred).

---

## 3. Confirmed decisions

1. **Partner bills only** this phase; client billing deferred (generate-vs-import decided later).
2. **Flat descriptor** (`FlatImportDescriptor`) — no grouping needed.
3. **Code** auto-generated `PBILL-<prefix>-MMYY-NNNN` via `formatPoCode` + the tagged `seedMaxSeq(codes, "PBILL")` sequencing; `MMYY` from `dateReceived` (fallback today).
4. **Dedup** on `(partnerId, partnerInvoiceNumber)` when an invoice number is present → skip; when absent, no dedup (create).
5. **Optional FK columns** (`clientName`, `partnerPoCode`): provided-but-unknown → row error; blank → null.
6. **Attachments deferred** (inserted null), consistent with the PO importers.

---

## 4. Partner Bill descriptor

New files under `app/lib/import/descriptors/`:
- `partner-bills.columns.ts` — client-safe columns + `partnerBillsMeta` (with `note`s + `sampleRows`).
- `partner-bills.ts` — the `FlatImportDescriptor`.

**CSV columns:**

| Column | Required | Type | Resolves / notes |
|--------|----------|------|------------------|
| `partnerName` | ✅ | string | → partner by name; partner must have a `codePrefix` (unknown/ambiguous/no-prefix → error) |
| `amount` | ✅ | number | USD, finite, ≥ 0; stored directly |
| `partnerInvoiceNumber` | — | string | the partner's own invoice number (dedup key) |
| `clientName` | — | string | → `clientId`; provided-but-unknown/ambiguous → error, blank → null |
| `partnerPoCode` | — | string | → `partnerPurchaseOrderId` by PPO `code`; provided-but-unknown → error, blank → null |
| `dateReceived` | — | `YYYY-MM-DD` | validated; drives the code's `MMYY` |
| `notes` | — | string | optional |

**`loadContext`** preloads: partners by normalized name (`{id, codePrefix}`); clients by normalized name (`{id}`); partner POs by `code` (`{id}`); existing dedup keys `${partnerId}|${normalizedInvoiceNumber}` for partner bills that have an invoice number; and `maxSeqByGroup` seeded from existing `PBILL-` codes via `seedMaxSeq(codes, "PBILL")`.

**`resolveRow`** per row:
- Resolve `partnerName` → partner (unknown/ambiguous → error; empty `codePrefix` → error `"partner has no code prefix"`).
- Parse `amount` (finite, ≥ 0; else error).
- If `clientName` non-blank → resolve `clientId` (unknown/ambiguous → error); blank → null.
- If `partnerPoCode` non-blank → resolve `partnerPurchaseOrderId` (unknown → error); blank → null.
- `dateReceived`: if present, validate `YYYY-MM-DD` (bad → error).
- Dedup: if `partnerInvoiceNumber` non-blank, key `${partnerId}|${normalizedInvoiceNumber}`; matches existing → skip; in-file duplicate (`seen`) → skip. If invoice number blank, no dedup (always create).
- Payload: `{ partnerId, prefix, partnerInvoiceNumber|null, clientId|null, partnerPurchaseOrderId|null, amount, dateReceived|null, notes|null }`.

**`commit`** (one transaction): for each payload, generate the `PBILL-` code (batch-sequenced per `(prefix, mmyy)`, `mmyy` from `dateReceived` or today), and insert into `partner_bills` with `attachmentUrl`/`attachmentName` null and `createdById` from the session.

**Descriptor typed** `FlatImportDescriptor<PbillContext, PbillPayload>` (concrete variant, as established in Phase 2); the registry holds the `ImportDescriptor` union.

---

## 5. Wiring (existing machinery)

- Register `partnerBillsDescriptor` in `registry.ts`.
- Add `partnerBillsMeta` to `catalog.ts`'s `importCatalog` → the `/upload` type picker gains "Partner Bills" with the Expected-columns table + sample CSV for free.
- Add `partner-bills` → `getListPartnerBillsQueryKey` to the page's `listKeyByType` map so the partner-bills list refetches after a commit. (Confirm the exact generated hook name during implementation.)

No route/OpenAPI/codegen changes — the generic `POST /api/import/{type}` already handles any registered type.

---

## 6. Error handling & edge cases

Unknown/ambiguous partner, partner without `codePrefix`, non-finite/negative `amount`, provided-but-unknown client or PPO code, bad `dateReceived`, existing/in-file duplicate (by partner + invoice number) → per the table above (row error or skip). Commit inserts valid rows in one transaction.

---

## 7. Testing

- **Unit** (`partner-bills.test.ts`): `resolveRow` — partner resolution (match/unknown/ambiguous/no-prefix), amount validation (reject non-finite/negative), optional client & PPO resolution (blank → null, unknown → error), `dateReceived` validation, dedup (invoice present: existing + in-file; invoice absent: always create), payload shape.
- **Route** (`partner-bills-route.test.ts` or added cases): dry-run (statuses, no writes) and commit (insert with `PBILL-…` code, `amount` stored, session user id) with mocked db.

---

## 8. Out of scope / deferred

- **Client billing** (`billings`) — its own later phase. Open question for that phase: generate the nested invoice in-app from imported partner POs + client rates + tax, vs. import a grouped reconstruction of lines/event-items with rate snapshots. Given it's derived data, generate-in-app is the likely direction.
- `.xlsx`, attachment upload during import, "update existing" re-import mode.