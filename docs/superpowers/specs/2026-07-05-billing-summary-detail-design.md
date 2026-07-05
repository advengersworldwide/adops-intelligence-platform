# Billing Summary & Billing Detail — Design

**Date:** 2026-07-05
**Status:** Approved (design); pending implementation plan
**Scope:** Replace the Financials **Transactions** and old **Billings** pages with two PO/event-based pages — **Billing Summary** and **Billing Detail** — driven by a new billing model. Adds global **Tax Settings**, a client **Bulk Discount %**, a per-billing invoice generator, and repoints **Payments** onto the new billings. Analytics stays on the old data and is untouched.

## Context — current state

Monorepo data flow (each layer is the source of truth for the next):

`lib/db/src/schema/*` (Drizzle) → `lib/api-spec/openapi.yaml` (API contract) → orval generates `lib/api-zod` (zod + TS types) and `lib/api-client-react` (React Query hooks) → `app/app/api/*` (Next.js route handlers) → `app/app/(dashboard)/*` (App Router pages).

**Being replaced (old, pin/AppsFlyer model):**
- `app/app/(dashboard)/transactions/page.tsx` — lists `billing_records` (per-platform pins). **Nav item removed.**
- `app/app/(dashboard)/billings/page.tsx` — `bills` aggregating `billing_records`. **Replaced** by the two new pages.
- Tables `billing_records`, `bills`, `bill_transactions` stay in the DB so **Analytics** (`app/app/api/analytics/*`, dashboard/by-client/by-platform/profit-over-time) keeps working. Rewiring Analytics onto the new model is out of scope.

**Reused as-is:**
- `clients` — `{ name, codePrefix, buyingHouseId (→ agency), ...kyc, paymentTermsId }`. Buying House (the invoice "Agency") via `buyingHouseId`.
- `client_events` — `{ id, clientId, name, costModelId, billableRate (numeric, $) }` — the client's **billable rate** per event.
- `partner_event_payouts` — `{ partnerId, clientEventId, payoutRate (numeric, $) }` — what we **pay a partner** per event.
- `client_purchase_orders` (CPO) — `{ code (PREFIX-MMYY-NNNN), clientId, attachmentUrl, createdById, createdAt }`. The billing is raised against one CPO; the CPO's month scopes the billing.
- `partner_purchase_orders` (PPO) + `partner_purchase_order_items` — the partner POs raised under a CPO; shown **for reference** during billing creation.
- `payment_terms`, `partners` (full KYC), `buying_houses`.
- Invoice code helper `app/lib/po-codes.ts` → `formatPoCode(prefix, date, seq)` = `PREFIX-MMYY-NNNN`.
- PDF pipeline: `app/lib/po-pdf.ts` (`html2canvas → jsPDF`) + `app/components/purchase-orders/PartnerInvoice.tsx` styling.
- Listing/dialog pattern: table-in-`rounded-2xl`-card + react-hook-form + zod + `PermissionGuard` / `useHasPermission`.
- Upload pattern: `app/app/api/uploads/payment-attachment/route.ts` (Supabase public URL).

## Decisions (locked with user)

1. **Billing scope:** a billing = **one Client PO** (client + month). It contains **one line per partner**; each partner line has its own payable and margin. The CPO's Partner POs are shown for reference during creation.
2. **Event counts:** **manually entered** per event per partner line. Partner POs are shown for reference only — counts are **not** auto-filled.
3. **Taxes are global.** New **Tax Settings** (Remittance %, Sales Tax %, Withholding %) under **Settings**. The per-client `salesTaxPct` and `withholdingTaxPct` fields are **removed**.
4. **Remittance gross-up is configurable:** `Gross = Net ÷ (1 − RemittanceRate)` using the global rate (replaces the hardcoded ÷0.85).
5. **WHT is an opt-in gross-up:** a **checkbox** on the billing. When on, apply the WHT gross-up **on top of** the remittance gross-up (both apply). When off, no WHT gross-up.
6. **Bulk Discount %** is a **client-level field**, prefilled into each billing (editable). BD is a **gross-based deduction** in Billing Detail (base = Gross, before sales tax).
7. **Billing Detail** keeps the three deductions from the sample: **Less WHT, Less SST, Less BD → Net Receivable.**
8. **Tax snapshotting:** each billing snapshots the global tax rates and the client BD at creation, so later rate changes never mutate an issued billing (mirrors the PO snapshotting decision).
9. **Invoice:** generated from Billing Detail **only when status = Approved**; number `{ClientPrefix}-MMYY-NNNN`, stored on the billing.
10. **Status values:** `Pending` (default) · `Approved` · `Dispute`.
11. **Payments** repoint from old `bills` onto the new **billings**; a payment can settle **multiple** billings.

## The calculation model

Rates: `RT` = Remittance %, `ST` = Sales Tax %, `WHT` = Withholding % (all global, snapshotted); `BD` = client Bulk Discount % (snapshotted). All computed **per partner line**, then summed to the billing total.

**Receivable**
1. `NetTotalUSD = Σ(eventCount × billableRate)`
2. `NetTotalPKR = NetTotalUSD × ForexSellingRate`
3. `GrossTotalPKR = NetTotalPKR ÷ (1 − RT/100)`  — remittance gross-up
4. **if `whtApplied`:** `GrossTotalPKR ×= (1 + g)`, where
   `g = ((1 + ST/100) × WHT/100) ÷ (1 − (1 + ST/100) × WHT/100)`
5. `SalesTax = GrossTotalPKR × ST/100`
6. `TotalInvoice = GrossTotalPKR + SalesTax`

**Detail deductions**
7. `LessWHT = TotalInvoice × WHT/100`
8. `LessSST = SalesTax`
9. `LessBD  = GrossTotalPKR × BD/100`  (BD base = gross, before sales tax)
10. `NetReceivable = TotalInvoice − LessWHT − LessSST − LessBD`

**Payable & margin**
11. `NetPayableUSD = Σ(eventCount × payoutRate)`
12. `NetPayablePKR = NetPayableUSD × ForexBuyingRate`
13. `NetMargin = NetReceivable − NetPayablePKR`

**Worked example** (sample data; `RT=15, ST=15, WHT=7, BD=20`, WHT checkbox **off**):

| step | value |
|---|---|
| NetTotalUSD | (1000×1.12)+(1000×0.40) = **1,520.00** |
| NetTotalPKR | 1,520 × 280 = **425,600.00** |
| GrossTotalPKR | 425,600 ÷ 0.85 = **500,705.88** |
| SalesTax | 500,705.88 × 0.15 = **75,105.88** |
| **TotalInvoice** | **575,811.76** |
| LessWHT | 575,811.76 × 0.07 = (40,306.82) |
| LessSST | (75,105.88) |
| LessBD | 500,705.88 × 0.20 = (100,141.18) |
| **NetReceivable** | **360,257.88** |
| NetPayableUSD | (1000×0.90)+(1000×0.32) = 1,220.00 |
| NetPayablePKR | 1,220 × 295 = 359,900.00 |
| **NetMargin** | **357.88** |

A single shared `computeBilling()` util in `app/lib/compute-billing.ts` holds this formula, imported by the API routes, both pages, and the invoice — same as the existing `app/lib/compute-row.ts` (one file serves server + client in this Next.js app).

## Data model

### New: `tax_settings` (single global row, `id = 1`)

| column | type | notes |
|---|---|---|
| `id` | serial PK | app enforces a single row |
| `remittanceTaxPct` | numeric(6,2) not null | |
| `salesTaxPct` | numeric(6,2) not null | |
| `withholdingTaxPct` | numeric(6,2) not null | |
| `updatedAt` | timestamptz `$onUpdate` | |

### Changed: `clients`

- **Add** `bulkDiscountPct numeric(6,2)`.
- **Remove** `salesTaxPct`, `withholdingTaxPct` (moved to global). Drop the matching fields from the client create/edit form and API.

### New: `billings` (header — one per CPO)

| column | type | notes |
|---|---|---|
| `id` | serial PK | |
| `clientId` | integer FK → `clients`, restrict | |
| `clientPurchaseOrderId` | integer FK → `client_purchase_orders`, restrict | scopes the month |
| `period` | text not null | `YYYY-MM`, from the CPO; stored for filtering |
| `forexSellingRate` | numeric(10,4) not null | receivable side |
| `forexBuyingRate` | numeric(10,4) not null | payable side |
| `bulkDiscountPct` | numeric(6,2) not null | snapshot of client BD, editable |
| `whtApplied` | boolean not null default false | the checkbox |
| `remittanceTaxPct` | numeric(6,2) not null | snapshot of global at create |
| `salesTaxPct` | numeric(6,2) not null | snapshot |
| `withholdingTaxPct` | numeric(6,2) not null | snapshot |
| `status` | text not null default `'pending'` | `pending` \| `approved` \| `dispute` |
| `invoiceCode` | text unique | null until invoice generated |
| `invoiceGeneratedAt` | timestamptz | null until generated |
| `notes` | text | |
| `createdById` | integer FK → `users.id`, set null | "Created By" |
| `createdAt` / `updatedAt` | timestamptz | |

### New: `billing_lines` (one per partner)

| column | type | notes |
|---|---|---|
| `id` | serial PK | |
| `billingId` | integer FK → `billings`, cascade | |
| `partnerId` | integer FK → `partners`, restrict | |
| `partnerPurchaseOrderId` | integer FK → `partner_purchase_orders`, set null | optional reference to the source PPO |
| `createdAt` | timestamptz | |

### New: `billing_event_items` (one per event per line)

| column | type | notes |
|---|---|---|
| `id` | serial PK | |
| `billingLineId` | integer FK → `billing_lines`, cascade | |
| `clientEventId` | integer FK → `client_events`, restrict | |
| `eventName` | text not null | **snapshot** |
| `billableRate` | numeric(12,4) not null | **snapshot** of client event rate |
| `payoutRate` | numeric(12,4) not null | **snapshot** of partner payout rate |
| `eventCount` | integer not null | manual |

All new tables added to `lib/db/src/schema/index.ts` + a Drizzle migration. Destructive migration acceptable (dev; no production data), which also covers dropping the two client tax columns.

### Invoice numbering

On **Generate Invoice** (status must be `approved`): `invoiceCode = formatPoCode(client.codePrefix, now, seq)` = `PREFIX-MMYY-NNNN`, where `seq` = count of billings already carrying an `invoiceCode` for that client in the current calendar year + 1. Persisted on the billing; idempotent (re-view uses the stored code).

## API

New route handlers under `app/app/api/`, declared in `lib/api-spec/openapi.yaml`, then `pnpm --filter @workspace/api-spec codegen`. Writes require `Edit Billings`; reads require the relevant view permission. `createdById` from `lib/auth/session.ts`.

**Tax settings**
- `GET /tax-settings` → the single row (auto-seeded with defaults if missing).
- `PUT /tax-settings` → update the three rates (permission: `Edit Settings`).

**Billings**
- `GET /billings?clientId=&period=&status=` → list with joined `clientName`, `buyingHouseName` (agency), `cpoCode`, `period`, `status`, `invoiceCode`, per-line partner names, and computed totals (Total Invoice, Net Receivable, Net Margin) for the collapsed row.
- `POST /billings` → `{ clientId, clientPurchaseOrderId, period, forexSellingRate, forexBuyingRate, bulkDiscountPct, whtApplied, notes, lines: [{ partnerId, partnerPurchaseOrderId?, items: [{ clientEventId, eventName, billableRate, payoutRate, eventCount }] }] }`. Server snapshots the global tax rates, generates nothing yet (no invoice), status `pending`.
- `GET /billings/{id}` → full detail (lines + items + snapshots) for Billing Detail and the invoice.
- `PATCH /billings/{id}` → edit forex/BD/WHT/notes/lines (re-snapshot event names + rates, recompute).
- `PATCH /billings/{id}/status` → `{ status }` (Approved / Dispute / Pending).
- `POST /billings/{id}/invoice` → 409 unless `status = approved`; generates + stores `invoiceCode`, returns it.
- `DELETE /billings/{id}`.

**Creation helpers** (mostly exist)
- `GET /clients/{id}/purchase-orders?period=` → CPOs for the client filtered to the month (existing route `clients/[id]/purchase-orders`, add `period` filter).
- `GET /partner-purchase-orders?clientPurchaseOrderId=` → the CPO's PPOs, with items, for the reference panel (add query filter to the existing list route).
- Rates: client events (`GET /clients/{id}/events` → `billableRate`) and partner payouts (existing `partners/[id]/clients/[clientId]/events/[eventId]/payout`) supply the auto-fetched rates when building a line.

**Payments** (repointed)
- New join table `payment_billings` `{ paymentId FK, billingId FK, amountApplied }` replaces `payment_bills` for the new flow.
- Add `paymentDate date` (date received) to `payments`; `createdAt` remains "date created". Attachment stays `receiptUrl`.
- `GET/POST/PATCH/DELETE /payments` allocate against **billings**. Settle-able list = billings with an `invoiceCode` (or `status=approved`) and a pending balance = `Σ NetReceivable − Σ amountApplied`.

## UI

Financials sidebar group: **Billing Summary** · **Billing Detail** · **Payments** · Cost (untouched). **Transactions** removed. New **Tax Settings** card on the Settings page.

### Create Billing (dialog, launched from Billing Summary)

1. **Client** dropdown.
2. **Month** picker → calls `GET /clients/{id}/purchase-orders?period=` → **CPO** dropdown (that month's POs).
3. **Reference panel:** the CPO's Partner POs (`GET /partner-purchase-orders?clientPurchaseOrderId=`) with their event/count/rate breakdown — read-only.
4. **Partner lines:** add one or more; per line pick a **Partner**, then **Events** (client's events); enter **count** per event. `billableRate` (client) and `payoutRate` (partner) auto-fetch and display; both are snapshotted on save.
5. **Forex Selling** & **Forex Buying** rates; **Bulk Discount %** (prefilled from client); **WHT** checkbox.
6. Totals preview via `computeBilling()`; **Create** (status `Pending`).

### Billing Summary page — `app/app/(dashboard)/billings/summary/page.tsx`

- **Expandable rows:** billing header (Client · Agency · Month · CPO code · **Total Invoice** · Status) → expand to **one sub-row per partner** with the receivable columns from the sample: per-event `count · billable rate · net billing`, then `Net Total USD · Forex · Net Total PKR · Gross Total PKR · Sales Tax · Total Invoice Amount`.
- **Row actions:** Edit · Delete · **Status dropdown** (Approved / Dispute / Pending).
- Filters: month, client, status. Permission: `View Billings`.

### Billing Detail page — `app/app/(dashboard)/billings/detail/page.tsx`

- Same rows as Summary **plus** `Less WHT · Less SST · Less BD · Net Receivable`, **plus** a payable block per line (`payout rate · net payable USD · Forex Buying · Net Payable PKR · **Net Margin**`).
- Status shown; **Generate Invoice** button per billing, enabled only when `status = approved` → opens the invoice.
- Permission: `View Billing Detail` (separate from Summary, since margins are internal).

Both pages share a `computeBilling()` util and row components; they differ only in the visible column set.

### Invoice — `app/components/billings/BillingInvoice.tsx` + route `app/app/(dashboard)/billings/[id]/invoice/page.tsx`

Full-page, print-ready, **Download PDF** via `app/lib/po-pdf.ts` (`html2canvas → jsPDF`), reusing `PartnerInvoice` styling.

```
[advengers logo]                                        INVOICE
                                     Invoice No: {PREFIX-MMYY-NNNN}
                                     Date: {invoiceGeneratedAt}
──────────────────────────────────────────────────────────────────
BILL TO  (client details: name, address, POC, tax identity)
──────────────────────────────────────────────────────────────────
Partner │ Agency │ Event │ Rate │ Count │ Line Total     ← per partner,
  …one block/row per partner used for this client…         per event
                                          Total of Events │ {ΣNetUSD}
              Forex │ Net Total PKR │ Gross Total PKR │ Sales Tax │
                                              Total Invoice Amount
──────────────────────────────────────────────────────────────────
Payment Terms: {client.paymentTerms}
This is a system generated document and does not require a physical signature.
──────────────────────────────────────────────────────────────────
        Advengers — Office #2, 1st Floor, Bldg #87-C, 11th Commercial
        St, Phase II Ext, DHA, Karachi, 74700 · www.advengers.com.pk
                              (centered footer)
```

- Columns = the Billing Summary breakdown (partners broken out, event details + rate + line total, total of events, forex, then Net Total PKR · Gross Total PKR · Sales Tax · Total Invoice Amount). No deductions, no clause block.
- **Agency** = client's Buying House. **Date** = `invoiceGeneratedAt`.

## Permissions

- Reuse `View Billings` (Summary) + `Edit Billings` (create/edit/delete/status/invoice).
- Add `View Billing Detail` (gates the Detail page's margin/payable). Admin + Manager get all; Viewer gets `View Billings` + `View Billing Detail` read-only per current role conventions in `app/scripts/seed.ts`.
- Tax Settings gated by the existing Settings edit permission.
- Sidebar items guarded accordingly; remove the Transactions nav entry.

## Files

**New**
- `lib/db/src/schema/{tax-settings,billings,billing-lines,billing-event-items,payment-billings}.ts` (+ index export + migration)
- `app/app/api/tax-settings/route.ts`
- `app/app/api/billings/route.ts`, `billings/[id]/route.ts`, `billings/[id]/status/route.ts`, `billings/[id]/invoice/route.ts`
- `app/app/(dashboard)/billings/summary/page.tsx`, `billings/detail/page.tsx`, `billings/[id]/invoice/page.tsx`
- `app/components/billings/{CreateBillingDialog,BillingSummaryTable,BillingDetailTable,BillingInvoice,StatusSelect}.tsx`
- `app/lib/compute-billing.ts` (single shared util — server + client)

**Changed**
- `lib/db/src/schema/{clients,payments,index}.ts` (client BD + drop tax fields; payments `paymentDate`)
- `lib/api-spec/openapi.yaml` (+ codegen regen of `lib/api-zod`, `lib/api-client-react`)
- `app/app/api/clients/**` (BD field; drop tax fields), `app/app/api/payments/**` (repoint to billings), `app/app/api/clients/[id]/purchase-orders/route.ts` (period filter), `app/app/api/partner-purchase-orders/route.ts` (CPO filter)
- `app/app/(dashboard)/payments/page.tsx` (settle billings; add date received)
- `app/app/(dashboard)/settings/page.tsx` (Tax Settings card)
- `app/app/(dashboard)/clients/page.tsx` (BD field; drop tax fields)
- `app/components/layout/Sidebar.tsx` (nav: remove Transactions, add Billing Summary + Billing Detail)
- `app/scripts/seed.ts` (permissions + seed a `tax_settings` row)

**Removed from nav (files may remain for Analytics):** `app/app/(dashboard)/transactions/page.tsx`, old `app/app/(dashboard)/billings/page.tsx`.

## Implementation phases

1. DB: `tax_settings`, `billings`, `billing_lines`, `billing_event_items`, `payment_billings`; client BD add + tax-field drop; payments `paymentDate`; migration + index; seed tax row + permissions.
2. API: tax-settings, billings CRUD + status + invoice, helper query filters; `openapi.yaml` + codegen.
3. `compute-billing.ts` (front + back mirror) with the worked-example test.
4. Settings → Tax Settings card; clients form BD/tax-field changes.
5. Sidebar rewire; Create Billing dialog; Billing Summary page.
6. Billing Detail page (deductions + payable + margin) + Generate Invoice.
7. Invoice document + PDF route.
8. Payments repoint (billings allocation, date received, receipt attachment).
9. QA polish (empty/loading/error states, responsive tables, permission gating).

## Out of scope

- Rewiring Analytics onto the new billings (stays on `billing_records`).
- Multi-currency; emailing invoices; editing the client-events / partner-payout catalogs.
- A PO-style status *workflow* beyond the three status values.

## Open considerations (non-blocking)

- **Per-client tax override:** dropped for now (global only). If a client ever needs a different rate, re-add an optional override later.
- **Analytics divergence:** two billing concepts coexist until Analytics is rewired; acceptable per decision.
- **Invoice sequence reset:** `seq` is per client per calendar year; confirm during QA that Jan rollover restarts at `0001`.