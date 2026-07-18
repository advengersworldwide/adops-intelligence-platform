# Import Engine — Phase 4 (Partner Payments) Design

**Date:** 2026-07-18
**Status:** Designed and approved (pending written-spec review)
**Builds on shipped:** Phases 1–3 (`docs/superpowers/specs/2026-07-13…`, `2026-07-15…`, `2026-07-18-import-engine-phase3-partner-bills-design.md`)

---

## 1. Context

The roadmap's remaining items are payments (client + partner) and client billing. Exploring payments surfaced the same asymmetry as billing:

- **Partner payments** (`partner_payments`) are **flat**: each references exactly one **partner bill** (`partnerBillId` NOT NULL) — which Phase 3 now imports — plus `amount` (USD), `mode`, `status` (`pending`|`settled`), `paymentDate`, `notes`. There is **no code** and **no allocation table**; `partnerId` is derived from the referenced bill. The create route enforces one rule: a payment can't exceed the bill's **remaining** unpaid amount (`bill.amount − Σ existing payments`).
- **Client payments** (`payments` + `payment_billings`) are a **header + allocations** across multiple client **billings**. They depend on client billings existing (not yet imported/generated) and are grouped.

**Decision:** Phase 4 delivers the **Partner Payments** importer only. Client payments are deferred until client billing is resolved (generate-vs-import).

No engine or route changes — partner payments are a flat importer plugging into the Phase-1 flat pattern + Phase-2/3 catalog/page machinery.

---

## 2. Goals & non-goals

**Goals**
- A **Partner Payments** flat importer, registered + selectable in the `/upload` picker (inheriting the Expected-columns view + sample CSV).

**Non-goals**
- Client payments (deferred), client billing (separate phase).
- Engine changes, generic-route/OpenAPI/codegen changes.
- Importing `sourceClientPaymentId` (the link to a funding client payment) or attachments — inserted null.
- A new engine `warning` status; over-allocation is an `error`.

---

## 3. Confirmed decisions

1. **Partner payments only** this phase; client payments deferred.
2. **Flat descriptor** (`FlatImportDescriptor`) — no grouping, **no code generation** (`partner_payments` has no code column).
3. **`partnerId` derived from the referenced bill** (not a CSV column).
4. **Over-allocation enforced:** a row errors if its `amount` exceeds the bill's remaining, accounting for existing DB payments **and** earlier valid rows in the same batch for that bill.
5. **Dedup** soft key `(partnerBillId, amount, paymentDate)` → skip existing/in-file duplicates (belt-and-suspenders with over-allocation).
6. **`status`** accepts `pending` (default) or `settled`; anything else → error.
7. **Attachments / `sourceClientPaymentId`** not imported (null).

---

## 4. Partner Payment descriptor

New files under `app/lib/import/descriptors/`:
- `partner-payments.columns.ts` — client-safe columns + `partnerPaymentsMeta` (note + sampleRows).
- `partner-payments.ts` — the `FlatImportDescriptor`.

**CSV columns:**

| Column | Required | Type | Resolves / notes |
|--------|----------|------|------------------|
| `partnerBillCode` | ✅ | string | → partner bill by `PBILL-` code → `partnerBillId`, `partnerId`, bill amount + remaining; unknown → error |
| `amount` | ✅ | number | USD, finite, > 0 |
| `status` | — | string | `pending` (default) or `settled`; else → error |
| `mode` | — | string | free text (e.g. "wire", "cheque") |
| `paymentDate` | — | `YYYY-MM-DD` | validated |
| `notes` | — | string | optional |

**`loadContext`** preloads:
- `billByCode`: `Map<code, { id, partnerId, amount, remaining }>`, where `remaining = amount − Σ existing partner_payments.amount` for that bill (one pass over all partner bills + all partner payments).
- `existingDedupKeys`: `Set<`${billId}|${amount}|${paymentDate}`>` from existing partner payments.
- `batchAllocated`: `Map<billId, number>` — **mutable**, starts empty; accumulates amounts of valid rows during the run (shared across `resolveRow` calls via the ctx object, so over-allocation sees earlier rows in the same file). Used identically in dry-run and commit.

**`resolveRow`** per row:
- Resolve `partnerBillCode` → bill (unknown → error). Derive `partnerId`/`partnerBillId` from it.
- Parse `amount` (finite, > 0; else error).
- `status`: cell value or `"pending"`; if not in {`pending`, `settled`} → error.
- `paymentDate`: if present, validate `YYYY-MM-DD`.
- **Dedup** (before over-allocation, so re-imports skip rather than error): key `${bill.id}|${amount}|${paymentDate ?? ""}`; matches `existingDedupKeys` or in-file `seen` → skip.
- **Over-allocation:** `available = bill.remaining − (batchAllocated.get(bill.id) ?? 0)`; if `amount > available + 0.01` → error `"Amount exceeds remaining <X> on bill <code>"`.
- On valid: `batchAllocated.set(bill.id, prev + amount)`, `seen.add(dedupKey)`, return payload `{ partnerId, partnerBillId, amount, mode|null, status, paymentDate|null, notes|null }`.

**`commit`** (one transaction): insert each payload into `partner_payments` with `sourceClientPaymentId: null`, `attachmentUrl: null`, `createdById` from session.

**Typed** `FlatImportDescriptor<PpayContext, PpayPayload>`; the registry holds the `ImportDescriptor` union.

---

## 5. Wiring (existing machinery)

- Register `partnerPaymentsDescriptor` in `registry.ts`.
- Add `partnerPaymentsMeta` to `catalog.ts`'s `importCatalog` → the `/upload` picker gains "Partner Payments".
- Add `partner-payments` → `getListPartnerPaymentsQueryKey` to the page's `listKeyByType`. (Confirm the exact generated hook name during implementation.)

No route/OpenAPI/codegen changes.

---

## 6. Error handling & edge cases

Unknown partner bill code, non-finite/≤0 amount, invalid status, bad `paymentDate`, over-allocation (single row or cumulative within the batch) → row error. Existing/in-file duplicate `(bill, amount, date)` → skip. Commit inserts valid rows in one transaction. Over-allocation and dedup both use the batch-shared ctx state so multi-row files behave correctly under dry-run and commit alike.

---

## 7. Testing

- **Unit** (`partner-payments.test.ts`): `resolveRow` — unknown bill; amount validation (reject non-finite/≤0/blank); invalid vs default status; `paymentDate` validation; **over-allocation** including cumulative in-batch (two rows to the same bill that jointly exceed remaining → second errors); dedup (existing + in-file); valid payload with `partnerId` derived from the bill.
- **Route** (`partner-payments-route.test.ts`): dry-run (statuses, no writes) and commit (insert with derived `partnerId`, stored `amount`, `sourceClientPaymentId`/`attachmentUrl` null) with mocked db.

---

## 8. Out of scope / deferred

- **Client payments** (`payments` + `payment_billings`) — grouped (header + allocations across client billings); blocked on client billing. Its own later phase.
- **Client billing** (`billings`) — derived data; generate-in-app vs. import to be decided in its own phase.
- `.xlsx`, attachment upload during import, "update existing" re-import mode.
