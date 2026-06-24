# Purchase Orders — Design

**Date:** 2026-06-24
**Status:** Approved (design); pending implementation plan
**Scope:** A new **Purchase Orders** sidebar section with two tabs — **Clients** (POs received from clients) and **Partners** (POs issued to partners). Includes 3 new DB tables, API endpoints, both listing/create UIs, and a downloadable, professionally-styled partner **invoice**. Consumes existing client events, partner payout rates, and partner↔client links. Does **not** modify profit/analytics calculations.

## Context — current state

Monorepo data flow (each layer is the source of truth for the next):

`lib/db/src/schema/*` (Drizzle) → `lib/api-spec/openapi.yaml` (API contract) → orval generates `lib/api-zod` (zod + TS types) and `lib/api-client-react` (React Query hooks) → `app/app/api/*` (Next.js route handlers) → `app/app/(dashboard)/*` (App Router pages).

Relevant existing pieces this feature reuses:
- **`clients`** — `{ name, buyingHouseId (FK), ...kyc, salesTaxPct, withholdingTaxPct, paymentTermsId }`. Buying house is reachable via `buyingHouseId`.
- **`client_events`** — `{ id, clientId, name, costModelId, billableRate (numeric, $) }`. One row per payable event per client (e.g. Sign-Ups, Reactivation).
- **`partners`** — `{ name, ...kyc, paymentTermsId }`. Full KYC set (address, POC, company contact, banking, tax identity).
- **`partner_event_payouts`** — `{ partnerId, clientEventId, payoutRate (numeric, $) }`, unique on `(partnerId, clientEventId)`. What we pay a specific partner for a specific client event.
- **`partner_clients`** — `{ partnerId, clientId }`, unique. Which clients a partner serves.
- Shared **KYC** column set in `lib/db/src/schema/kyc-columns.ts`.
- **Listing pattern**: table-in-`rounded-2xl`-card + create **Dialog** (react-hook-form + zod) + `PermissionGuard` / `useHasPermission`. Reference: `app/app/(dashboard)/partners/page.tsx`.
- **Upload pattern**: `app/app/api/uploads/payment-attachment/route.ts` posts a file to a Supabase storage bucket and returns a public URL.
- **Permissions** are enumerated as string arrays per role in `app/scripts/seed.ts` and gate nav items in `app/components/layout/Sidebar.tsx`.
- `jspdf`, `jspdf-autotable`, and `html2canvas` are already resolved in `pnpm-lock.yaml`.

## Decisions (locked with user)

1. **Partner PO rate source:** the **partner payout rate** (`partner_event_payouts.payoutRate`) — what we pay that partner per event. Preserves margin (client billable rate − partner payout rate).
2. **Partner PO flow:** select **Partner first** → Client dropdown filtered to that partner's linked clients → select that client's CPO → duration → events.
3. **Invoice "Agency" column** = the client's **Buying House**.
4. **Invoice output:** on-screen view + **Download PDF**.
5. **PDF method:** **exact visual match** — one HTML/Tailwind invoice captured via `html2canvas → jsPDF`. (PDF text is rasterized; acceptable for a final document.)
6. **Partner PO attachment:** none — Partner POs are system-generated; "View" opens the generated invoice. Only **Client POs** carry an uploaded attachment.
7. **ID format:** `CPO-YYYY-####` / `PPO-YYYY-####`, sequential per calendar year.
8. **Currency:** USD (`$`).
9. **CPO delete:** blocked while linked PPOs exist; PPO delete always allowed.
10. **Rate/name snapshotting:** PPO line items copy event name + payout rate at creation time, so later rate changes never mutate an issued invoice.

## Data model — 3 new tables

### `client_purchase_orders` (CPO)

| column | type | notes |
|---|---|---|
| `id` | serial PK | |
| `code` | text, unique, not null | human ID, e.g. `CPO-2026-0001` |
| `clientId` | integer FK → `clients`, `onDelete: restrict` | buying house derived via `clients.buyingHouseId` |
| `attachmentUrl` | text, not null | uploaded email/screenshot/PDF (Supabase public URL) |
| `attachmentName` | text | original filename for display |
| `createdById` | integer FK → `users.id`, `onDelete: set null` | "Created By" (joins to `users.name`) |
| `createdAt` | timestamptz, default now | |
| `updatedAt` | timestamptz, `$onUpdate` | |

### `partner_purchase_orders` (PPO)

| column | type | notes |
|---|---|---|
| `id` | serial PK | |
| `code` | text, unique, not null | human ID + invoice number, e.g. `PPO-2026-0001` |
| `partnerId` | integer FK → `partners`, `onDelete: restrict` | |
| `clientPurchaseOrderId` | integer FK → `client_purchase_orders`, `onDelete: restrict` | the CPO this is raised against; client derived from it |
| `startDate` | date, not null | "Duration" start |
| `endDate` | date, not null | "Duration" end |
| `totalBudget` | numeric(14,2), not null | stored sum of line budgets (listing convenience) |
| `createdById` | integer FK → `users.id`, `onDelete: set null` | "Created By" (joins to `users.name`) |
| `createdAt` | timestamptz, default now | |
| `updatedAt` | timestamptz, `$onUpdate` | |

### `partner_purchase_order_items` (PPO line items)

| column | type | notes |
|---|---|---|
| `id` | serial PK | |
| `partnerPurchaseOrderId` | integer FK → `partner_purchase_orders`, `onDelete: cascade` | |
| `clientEventId` | integer FK → `client_events`, `onDelete: restrict` | reference to the event |
| `eventName` | text, not null | **snapshot** at creation |
| `cacRate` | numeric(12,4), not null | **snapshot** of partner payout rate at creation |
| `eventCount` | integer, not null | |
| `lineBudget` | numeric(14,2), not null | `cacRate × eventCount` |

- Add all three to `lib/db/src/schema/index.ts`. Generate a Drizzle migration. Destructive migration acceptable (dev; no production data).

### Derived values (not stored)

- **Buying House** (both listings + invoice "Agency") = `clients.buyingHouseId → buying_houses.name`.
- **Client Name** on a PPO = via `clientPurchaseOrderId → client_purchase_orders.clientId → clients.name`.
- **Total Budget** is stored on the PPO but always equals `sum(items.lineBudget)`.

### ID generation

Server-side on create: `CPO-{year}-{seq}` / `PPO-{year}-{seq}`, where `seq` is a zero-padded (4-digit) count of existing rows for that table in the current year + 1. Computed inside the create handler.

## API

New route handlers under `app/app/api/`, declared in `lib/api-spec/openapi.yaml`, then `pnpm --filter @workspace/api-spec codegen` regenerates `lib/api-zod` + `lib/api-client-react`. All write routes require the `Edit Purchase Orders` permission; reads require `View Purchase Orders`. `createdById` comes from the auth session (`lib/auth/session.ts`).

**Client POs**
- `GET /client-purchase-orders` → list with joined `clientName`, `buyingHouseName`, `createdByName`.
- `POST /client-purchase-orders` → `{ clientId, attachmentUrl, attachmentName }`; server generates `code`, stamps `createdById`.
- `GET /client-purchase-orders/{id}` → detail.
- `PATCH /client-purchase-orders/{id}` → update client / replace attachment.
- `DELETE /client-purchase-orders/{id}` → 409 if linked PPOs exist.

**Partner POs**
- `GET /partner-purchase-orders` → list with joined `partnerName`, `buyingHouseName`, `clientName`, `createdByName`, `totalBudget`, and nested `items` (for the expandable breakdown).
- `POST /partner-purchase-orders` → `{ partnerId, clientPurchaseOrderId, startDate, endDate, items: [{ clientEventId, eventName, cacRate, eventCount, lineBudget }] }`; server generates `code`, recomputes `totalBudget` server-side from items (never trusts client total), stamps `createdById`.
- `GET /partner-purchase-orders/{id}` → full detail for the invoice (partner KYC, client, buying house, items).
- `PATCH /partner-purchase-orders/{id}` → update duration/items (re-snapshot + recompute total).
- `DELETE /partner-purchase-orders/{id}`.

**Cascading-dropdown helpers**
- `GET /partners/{partnerId}/clients` → clients linked to a partner (via `partner_clients`).
- `GET /clients/{clientId}/client-purchase-orders` → `{ id, code, createdAt }[]` for that client (CPO dropdown).
- `GET /partners/{partnerId}/payable-events?clientId=` → `{ clientEventId, name, payoutRate }[]` — join `client_events` (where `clientId`) × `partner_event_payouts` (where `partnerId`). Only events that have a configured payout rate for this partner appear.

**Upload**
- `POST /api/uploads/po-attachment` — mirrors the existing `payment-attachment` route into a `po-attachments` Supabase bucket; returns `{ url }`.

## UI

New sidebar item **Purchase Orders** (lucide `ClipboardList`) after Partners, guarded by `View Purchase Orders`. Route `app/app/(dashboard)/purchase-orders/page.tsx` renders a shadcn **Tabs** shell: **Clients** and **Partners**. Create/Edit/Delete affordances gated by `Edit Purchase Orders`.

### Clients tab — `components/purchase-orders/ClientPOTab.tsx`

- **Listing columns:** `Sr.No | CPO ID | Client Name | Buying House | Created Date | Created By | Actions`.
- **Actions:** View · Edit · Delete · Attachment (opens uploaded file in a new tab; disabled if none).
- **Create modal** (`CreateClientPODialog.tsx`): select **Client** (dropdown) → **upload** attachment (file picker, required) → **Create**. Submit = upload file to `po-attachment` → `POST /client-purchase-orders`. Buying House is read from the chosen client.
- **View** = read-only detail + attachment preview. **Edit** = change client / replace attachment. **Delete** = confirm via `alert-dialog`; surfaces the 409 "remove linked Partner POs first".

### Partners tab — `components/purchase-orders/PartnerPOTab.tsx`

- **Listing columns:** `Sr.No | PPO ID | Partner Name | Buying House | Client Name | Total Budget | Created Date | Created By | Actions`.
- **Expandable row:** a leading chevron toggles a `Collapsible` showing the event **breakdown** — `Payable Event | CAC Rate | Event Count | Budget` per item + the row total.
- **Actions:** View (invoice) · Edit · Delete.
- **Create modal** (`CreatePartnerPODialog.tsx`):
  1. **Partner** dropdown (all partners).
  2. **Client** dropdown — filtered to that partner's linked clients (`GET /partners/{id}/clients`).
  3. **Client PO** dropdown — that client's CPOs as `CPO-… (date)`.
  4. **Duration** — date-range picker (`calendar` component), start → end.
  5. **Events** — multi-select; each chosen event renders a row: **event name · CAC rate (auto = payout rate, read-only) · count input · line budget (auto = rate × count)**.
  6. **Total budget** auto-sums at the bottom.
  7. **Create** → `POST /partner-purchase-orders` with snapshotted items.
  - Example row: `Sign-Ups · 0.80 · 1000 · $800.00`.

### Invoice — `components/purchase-orders/PartnerInvoice.tsx` + route `purchase-orders/ppo/[id]/page.tsx`

View on a Partner PO opens a dedicated full-page route rendering a polished, print-ready document. A **Download PDF** button captures the invoice node via `html2canvas → jsPDF` (helper in `lib/po-pdf.ts`); handles multi-page by slicing the canvas if it exceeds one page. Layout takes the *feel* of the sample PO PDF but the *table* from the screenshot:

```
[advengers logo]                                   PURCHASE ORDER
                                          Invoice No: PPO-2026-0001
                                          Date: 24 Jun 2026
──────────────────────────────────────────────────────────────────
VENDOR (partner KYC, auto-filled)
Name · Address · POC name / number · Email · NTN / Sales-Tax No.
──────────────────────────────────────────────────────────────────
Client │ Agency │ Duration │ Payable Event │ CAC Rate │ Count │ Budget
JazzCash│ Blitz  │1/6-30/6/26│ Sign-Ups     │  0.80    │ 1000  │ $800
JazzCash│ Blitz  │1/6-30/6/26│ Reactivation │  0.20    │ 1000  │ $200
                                                  TOTAL  │       │ $1,000
──────────────────────────────────────────────────────────────────
Clause: [placeholder — final text provided by user later]
This is a computer-generated document and does not require a
signature or stamp.
──────────────────────────────────────────────────────────────────
Advengers — Office #2, 1st Floor, Bldg #87-C, 11th Commercial St,
Phase II Ext, DHA, Karachi, 74700 · www.advengers.com.pk
```

- **Agency** column = the client's Buying House.
- **CAC Rate** column = the partner payout rate (snapshot).
- **Vendor block** = partner KYC auto-filled from `partners`.
- **No grey comments box** (present in the sample PDF) — replaced by the **clause** block.
- **Footer** = Advengers company details (from the sample PO) + computer-generated note.
- **Invoice number** = the PPO `code`; **Date** = `createdAt`.

## Permissions, assets, files

- **Permissions:** add `View Purchase Orders` + `Edit Purchase Orders` to role arrays in `app/scripts/seed.ts` (Admin + Manager get both; Viewer gets View). Sidebar item guarded by `View Purchase Orders`.
- **Assets needed from user:** the **Advengers logo** file → `app/public/advengers-logo.*`; the final **clause text** (placeholder until provided).

**New files:**
- `lib/db/src/schema/client-purchase-orders.ts`, `partner-purchase-orders.ts`, `partner-purchase-order-items.ts` (+ index export + migration)
- `app/app/api/client-purchase-orders/**`, `partner-purchase-orders/**`, `partners/[id]/clients/route.ts`, `clients/[id]/client-purchase-orders/route.ts`, `partners/[id]/payable-events/route.ts`, `uploads/po-attachment/route.ts`
- `app/app/(dashboard)/purchase-orders/page.tsx`, `purchase-orders/ppo/[id]/page.tsx`
- `app/components/purchase-orders/{ClientPOTab, CreateClientPODialog, PartnerPOTab, CreatePartnerPODialog, PartnerInvoice}.tsx`
- `app/lib/po-pdf.ts`
- `app/public/advengers-logo.*`

**Changed files:** `lib/api-spec/openapi.yaml`, `lib/db/src/schema/index.ts`, `app/components/layout/Sidebar.tsx`, `app/scripts/seed.ts`, `app/package.json` (promote `html2canvas` to a direct dependency).

## Implementation phases

1. DB schema (3 tables) + migration + index export; add permissions to seed.
2. API route handlers + `openapi.yaml` + `codegen` (regenerate hooks).
3. Sidebar item + `/purchase-orders` Tabs shell + permission guard.
4. Clients tab — listing, create modal (with upload), view/edit/delete.
5. Partners tab — listing, expandable breakdown, cascading multi-step create modal.
6. Invoice document component + view route + Download PDF helper.
7. QA polish (empty states, loading skeletons, error toasts, responsive table).

## Out of scope

- Profit/analytics rewiring. Multi-currency. Approval workflows / PO status lifecycle. Emailing invoices to partners. Editing of the global client-events / partner-payout catalogs (already exist elsewhere).
