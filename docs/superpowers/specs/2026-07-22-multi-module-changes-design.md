# AdOps Platform — Multi-Module Changes (Design / Roadmap)

**Date:** 2026-07-22
**Branch (base):** `feat/granular-rbac`
**Status:** Approved shape; per-phase implementation plans to follow.

## Context

A batch of changes spanning bulk upload, payment modals, table filtering, the partner
table, aging, currency display, charts, the alert widget, and two analytics
clarifications. Rather than one monolithic change, the work is split into **6 independently
shippable phases**. Each phase gets its own implementation plan (via writing-plans) and can
be reviewed/merged on its own.

Two investigation items from the request are already answered and require no separate build:

- **"How is cost/profit/margin computed when I never entered a cost?"** — There is no
  separate cost input. `computeRow` ([app/lib/compute-row.ts](../../../app/lib/compute-row.ts))
  derives everything from each billing record's `payoutRate` (USD per PIN) and `marginPct`.
  **Revenue** = `receivablePkr` (client side), **Cost** = `totalPayablePkr` (partner
  payout / COGS), **Profit** = revenue − cost. The `/cost` page and cost-models do **not**
  feed these numbers. Action folded into Phase 2: relabel analytics "Cost" → "Partner
  Payout" (or "COGS") to remove the ambiguity.
- **"Traffic quality shows more PINs than I added."** — `buildFraudSeries`
  ([app/lib/analytics/fraud.ts](../../../app/lib/analytics/fraud.ts)) sums **gross**
  `appsflyerPins` across every billing record in a period. Multiple records in the same
  month add up, and it plots gross (not valid) PINs. Fixed in Phase 2.

## Currency model (foundational decision)

The data is already coherent; the `$`-on-PKR problem is a **display/default** issue, not a
data problem. Confirmed semantics:

| Thing | Currency | Notes |
|-------|----------|-------|
| Event rates (`billableRate`, `payoutRate`) | **USD** | Negotiated in USD. `$` is correct. Label explicitly. |
| Client invoice / receivable / client payments | **PKR** | Rates × `forexSellingRate`. Client settles PKR. `$` here is the bug. |
| Partner bills / partner payments | **USD** | You remit to the DSP in USD. `$` is correct. |
| Analytics / dashboard aggregates | **base currency (default PKR)** | Mixed PKR+USD must unify; see below. |

**Decision (approved):**

- A **global base currency** lives in **Settings, persisted to the DB** (default **PKR**).
  It governs **analytics + dashboard aggregates only**.
- **Transactional documents keep their native settlement currency, always correctly
  labeled** and do **not** flip with the toggle: client docs = PKR, partner docs = USD,
  rates = USD.
- Conversions **prefer the per-record `forexSellingRate`/`forexBuyingRate`** already stored
  on each record; the global rate is only a fallback/normalization for aggregate display.
- The global rate **never re-derives** stored amounts (no historical drift).

### Why not a single global rate for everything
1. Each record already carries its own transaction-time forex; a single global rate would
   distort historical figures if used to re-derive them.
2. Buying (partner) ≠ selling (client) rate — one number can't represent both as a
   settlement rate; the global rate is display-only.
3. Round-tripping a PKR invoice back to USD is lossy (taxes/gross-up/margin sit between the
   USD net and the PKR invoice).

### Current state to fix
- Settings base-currency selector + FX editor already exist but write **only to
  `localStorage`** and **default to `"USD"`**
  ([app/app/(dashboard)/settings/page.tsx](../../../app/app/(dashboard)/settings/page.tsx) ~L103).
- Charts (e.g. [CashFlowChart](../../../app/components/analytics/charts/CashFlowChart.tsx))
  read that localStorage value and convert PKR→USD → the "graphs in USD" bug.
- KPI cards go the other way: [use-adjusted-summary.ts](../../../app/lib/dashboard/use-adjusted-summary.ts)
  hardcodes `"PKR"` and does not convert. Cards say PKR, charts say USD.
- Many spots call `formatMoney(x)` with no currency → defaults to `$`.

---

## Phase 1 — Currency consolidation

**Goal:** One consistent, DB-backed base currency (default PKR); PKR amounts never render
`$`; USD stays USD for rates + partner amounts; per-record forex preserved.

**Schema**
- New singleton `app_settings` table (or extend the existing `tax_settings` singleton) with:
  - `base_currency` text (default `'PKR'`)
  - (optional) `usd_selling_default` / `usd_buying_default` numeric — defaults used to
    prefill new billing records/billings; **not** used to re-derive existing rows.
- API: `GET/PATCH /api/app-settings` (RBAC-gated like tax-settings).

**Code**
- `formatMoney(n, currency)` in
  [app/lib/analytics/currency.ts](../../../app/lib/analytics/currency.ts):
  change default from `"USD"` to the base currency; ensure a PKR amount renders `PKR`
  (or `Rs`), never `$`. Add a `formatRate()` helper that always labels USD.
- Replace all `localStorage.getItem("adops-base-currency")` reads with a single
  `useBaseCurrency()` hook sourced from the DB setting (React Query), with localStorage as a
  cache only.
- Fix [use-adjusted-summary.ts](../../../app/lib/dashboard/use-adjusted-summary.ts) to read
  the real base currency (dashboard endpoint already returns PKR; if base = PKR, no
  conversion; if base ≠ PKR, convert via the global rate for display only).
- Audit every `formatMoney(...)` / local `fmt()` call site; pass explicit currency; kill
  hardcoded `$` prefixes (e.g. partner table `fmt`, alerts route).

**Acceptance**
- With base = PKR (default), no `$` appears on any client/analytics amount; charts + KPI
  cards agree.
- Event rates and partner bills/payments still show USD.
- Changing base currency in Settings updates dashboards/charts app-wide (shared across
  sessions), and does not change any stored invoice/bill amount.

**Out of scope:** multi-currency invoicing; automatic FX providers beyond the existing
optional fetch.

---

## Phase 2 — Quick wins

**A1 — Partner table cleanup**
([app/app/(dashboard)/partners/page.tsx](../../../app/app/(dashboard)/partners/page.tsx)):
remove Revenue / Cost / Profit / Margin % columns and the `useGetAnalyticsByPartner` call +
the `$`-hardcoded `fmt`. Keep Name, Payment Terms, Actions.

**A2 — Payment terms "days"**: show the day count everywhere a term is displayed —
Settings list (`Net 30 days`) and the partner table/detail (`Net 30 days` instead of just
the name). Source: `paymentTerms[].days`.

**A4 — Chart legends**: add a `<Legend />` (or equivalent) to every chart in
[app/components/analytics/charts](../../../app/components/analytics/charts) that lacks one, so
each series is labeled.

**A5 — Alert widget scroll + 7-day cap**:
- [NeedsAttention widget](../../../app/components/dashboard/widgets/NeedsAttention.tsx):
  add `max-h` + `overflow-y-auto` so it scrolls when constrained.
- [alerts route](../../../app/app/api/analytics/alerts/route.ts): cap to alerts whose
  relevant record/period falls within the **last 7 days** (define "last 7 days" during
  planning — by record period vs. computed-at; likely filter overdue/fraud/margin alerts to
  recent records and cap the count).

**A6 — Traffic-quality PIN fix**: chart should plot **valid PINs** (`appsflyer − fraud`) and
not appear inflated. Align the traffic-quality view to what the user actually enters
(confirm during planning whether they expect per-record or period-summed values).

**A-cost-label**: relabel analytics "Cost" → "Partner Payout" / "COGS" where it appears.

**Acceptance:** each item visually verified; no regressions in analytics totals.

---

## Phase 3 — Aging: settled = green, with days-to-settle

**Goal:** When a bill is settled, aging stops, the pill turns **green**, and it shows how
long settlement took (e.g. `Settled (12d)`), preserving the metric for later.

**Schema**
- Add `settled_at timestamp NULL` to `billings` and `partner_bills`. Set it when cumulative
  received ≥ receivable (and clear if it drops back below). Backfill not required (NULL =
  unknown; fall back to derive-from-last-payment for legacy rows if feasible).

**Code**
- [app/lib/aging.ts](../../../app/lib/aging.ts): when `settled`, return
  `color: "green"` and `daysToSettle = settledAt − start`.
- [AgingPill.tsx](../../../app/components/billings/AgingPill.tsx): green pill, label
  `Settled (Nd)`; keep neutral `—` only when there's no start/term.
- Set `settled_at` in the billing/partner-bill payment-application paths (payments create/
  update/delete and status changes).

**Acceptance:** settling a bill turns its pill green with the day count; unsettling reverts;
aging no longer accrues after settlement.

---

## Phase 4 — Filters, search & sort

**Goal:** A reusable table toolbar (search + relevant column filters + sortable headers) on
**Purchase Orders**, **Billings**, and **Payments** tabs. Client-side (lists already loaded
via `useList*` hooks).

**Code**
- New shared component `components/ui/TableToolbar` (or `useTableControls` hook) providing:
  free-text search, per-table filter controls (status, client, partner, month, date range as
  relevant), and sortable column headers.
- Wire into: PO tabs
  ([ClientPOTab](../../../app/components/purchase-orders/ClientPOTab.tsx),
  [PartnerPOTab](../../../app/components/purchase-orders/PartnerPOTab.tsx)), billing tabs
  ([ClientBillingSummaryTab](../../../app/components/billings/ClientBillingSummaryTab.tsx),
  ClientBillingDetailTab, [PartnerBillingTab](../../../app/components/billings/PartnerBillingTab.tsx)),
  payment tabs ([ClientPaymentsTab](../../../app/components/payments/ClientPaymentsTab.tsx),
  [PartnerPaymentsTab](../../../app/components/payments/PartnerPaymentsTab.tsx)).

**Acceptance:** each table supports search, ≥1 relevant filter, and sort on key columns;
state resets cleanly; empty-state messaging preserved.

---

## Phase 5 — Payment modals rework

**Goal:** Guided client→month→bill and partner→month→bill flows, with system-generated
reference codes.

**Client payment**
([ClientPaymentsTab](../../../app/components/payments/ClientPaymentsTab.tsx) PaymentDialog):
1. Select **Client** → 2. Select **Month (period)** → 3. Show that client's billings for the
   month (invoice code + amount), auto-expanded to show partner(s) + event/rate summary →
   4. Pick/edit amount received per bill (partial/full) — existing allocation mechanic.
- Add a **system-generated payment reference code** (e.g. `CPMT-<clientPrefix>-MMYY-NNNN`,
  mirroring the `PBILL`/`INV` pattern via `formatPoCode`).

**Partner payment**
([CreatePartnerPaymentDialog](../../../app/components/payments/CreatePartnerPaymentDialog.tsx)):
1. Select **Partner** → 2. Select **Month** → 3. Show that month's **PBILL(s)** + the
   funding client-payment(s) received → 4. Pick amount paid (partial/full).
- Add a **system-generated payment reference code** (e.g. `PPMT-<partnerPrefix>-MMYY-NNNN`).

**Schema**
- Add `reference_code text UNIQUE NULL` to `payments` and `partner_payments`, generated on
  create. Client bills already carry `invoiceCode` (`INV-…`) and partner bills `code`
  (`PBILL-…`) as their references; confirm during planning whether the client bill also
  needs a distinct generated code beyond `INV-…`.
- New code sequences for `CPMT` / `PPMT` (reuse the existing PO/bill sequence approach).

**Acceptance:** both modals follow the select→month→bill flow; amounts default to
remaining; partial and full both work; each new payment gets a unique reference code shown in
the table.

**Currency:** client payments display PKR; partner payments display USD (per Phase 1).

---

## Phase 6 — Bulk upload rework (two importers)

**Goal:** Replace/trim the current importer set so bulk upload offers **two client-scoped
sheets** — **"Client Billing Summary"** and **"Partner Billing"** — with strong validation.

**Shared behavior (both importers)**
- **Client is selected first** in the UI; upload proceeds only if the selected client's name
  appears in the sheet. Mismatch → clear error.
- **Duplicate flagging**, both:
  - within the sheet (same key appearing twice), and
  - against the system (a matching record already exists) — for the same
    client + partner + period (+ event where relevant).
- **Precise template diagnostics**: identify the specific problem preventing upload —
  missing/renamed required columns, wrong data types, unknown partner/client/cost-model
  names, unparseable numbers — surfaced per-row and as file-level errors (builds on the
  existing dry-run + error-report engine in
  [app/lib/import/run-import.ts](../../../app/lib/import/run-import.ts) and descriptors).

**Column definitions — TBD in this phase's design.** The two sheets map roughly to:
- **Partner Billing** → the `billing_records` fields (period, partner, buying house, cost
  model, PINs, fraud PINs, payout rate, margin %, forex buying/selling, taxes).
- **Client Billing Summary** → the client-facing summary (client, period, partner(s),
  events, billable rates, forex selling, taxes) feeding the client invoice view.
- Exact headers, required vs optional, and how each maps to existing tables will be nailed
  down with the user before building (per the answer "I'll ask you what columns each needs").

**In-app flows unchanged:** the existing "generate client billing" and in-app payment flows
stay; bulk upload complements them.

**Acceptance:** selecting a wrong client (not in sheet) blocks upload with a clear message;
duplicates (in-sheet and in-system) are flagged in the preview; malformed templates report
the exact cause; valid rows import and appear in the corresponding views.

---

## Cross-cutting

- **RBAC:** every new/changed API route enforces the appropriate permission (project already
  standardized on catalog-driven RBAC).
- **Tests:** unit tests for new pure logic (currency defaults, aging with `settledAt`,
  duplicate detection, reference-code generation); keep the suite green.
- **Migrations:** Drizzle migrations for `app_settings`/`tax_settings` currency fields,
  `settled_at`, and `reference_code`. All nullable; no destructive backfill.

## Suggested sequence
1 → 2 → 3 → 4 → 5 → 6. Phase 1 first because it underpins the `$` fix, charts, KPIs, and
partner display. Phases 5 and 6 are the largest and each get a dedicated design pass
(payment-modal UX; bulk-upload column contracts).

## Open items to resolve at per-phase planning
- Phase 2/A5: exact definition of the alert "last 7 days" window.
- Phase 2/A6: whether traffic-quality should show per-record or period-summed valid PINs.
- Phase 5: whether the client **bill** needs a generated reference distinct from `INV-…`.
- Phase 6: full column contracts for both sheets.
