# Retire the Legacy "Media" Model — Design

**Date:** 2026-07-22
**Status:** Approved (design)
**Scope decision:** Re-point the dashboard/analytics "Media" layer from the dead `transactions`/`campaigns` tables to the live `billing_records` model (via `computeRow`), delete the orphaned `transactions` + `bills` code, and drop 5 stale tables. Revenue basis confirmed: **`billing_records` via `computeRow`**.

---

## 1. Context — what the investigation found

An audit of all 29 DB tables (row counts + write-paths + frontend reads) showed the dashboard/analytics "Media" layer is built on **empty, orphaned tables**:

- The sidebar nav (the real frontend surface) is: Dashboard · Clients · Buying Houses · Partners · Purchase Orders · Billing · Payments · Cost · Upload · Analytics · Settings. There is **no Transactions or Bills** nav item.
- **`transactions` (0 rows)** and **`campaigns` (0 rows)** have no create UI, no importer, and no nav page. Their only writer is an orphaned `POST /api/transactions`. Yet ~11 analytics endpoints sum them, so those endpoints return **$0** on real data.
- The old client-billing chain **`bills` (3)**, **`bill_transactions` (8)**, **`payment_bills` (0)** has a CRUD API but **no `.tsx` page calls it** (`useListBills`/`useGetBill` are unused in the frontend); it's superseded by `billings`/`payment_billings`.
- The **live** revenue data lives in **`billing_records` (5 rows)** — the per-period performance records used by the Clients / Partners / Buying-Houses pages and the fraud view — and in `billing_event_items` (3, the invoice/events layer). The dashboard's headline KPIs never touch either.

**Net effect:** a large part of the just-shipped dashboard (KPIs, profit trend, client/platform performance, concentration, forecast, anomalies, alerts, AI insights, recent transactions, needs-attention) reads dead data and shows zeros.

## 2. Goals & non-goals

**Goals**
- Make the dashboard/analytics show **real numbers** by re-pointing the "Media" layer to `billing_records` via the existing `computeRow()`.
- **Delete** the orphaned `transactions` + `bills` code paths and **drop** the 5 stale tables.
- Keep every currently-live widget and page working; lose no live functionality.

**Non-goals**
- No change to the live billing/invoice flow (`billings`, `billing_lines`, `billing_event_items`), payments (`payments`, `payment_billings`, `partner_bills`, `partner_payments`), POs, or entity pages.
- No new revenue model — reuse `computeRow` (the proven buying-house-analytics derivation).
- Not touching `billing_records` itself (it's live) or the `/transactions` page (it already manages `billing_records`, not the transactions table — it stays as-is).
- Not incorporating `billing_event_items`/`billings` net-invoice values into headline KPIs in this project (billing_records P&L is the confirmed basis; the invoice layer already has its own Financial-Ops widgets).

## 3. Data model: dead vs live

**🔴 DROP (stale — 5 tables):** `campaigns`, `transactions`, `bills`, `bill_transactions`, `payment_bills`.

**🟢 KEEP (live):** everything else — notably `billing_records` (core P&L source), `billings`/`billing_lines`/`billing_event_items`, `partner_bills`/`partner_payments`/`payments`/`payment_billings`, all POs, `client_events`, `cost_models`, `cost_resources` (empty but the Cost page manages it), entities, `payment_terms`, `tax_settings`, `roles`, `users`, `dashboard_layouts`.

## 4. Metric re-point (the core change)

Replace the `transactions` spend/cost/profit basis with per-record `computeRow()` output, summed over `billing_records`. `computeRow(r)` (`app/lib/compute-row.ts`, pure) returns, per record, PKR figures:

- **Revenue** = `Σ computeRow(r).receivablePkr`
- **Cost** = `Σ computeRow(r).totalPayablePkr`
- **Profit** = `Σ computeRow(r).netMarginPkr` ( = receivable − payable)
- **Margin %** = profit / revenue

**Dimensions** (all native columns on `billing_records`): `clientId`, `platformId` (partner), `buyingHouseId`, `costModelId`, `period` (`"YYYY-MM"`). This is a **superset** of what `transactions`/`campaigns` offered (which lacked buying-house and cost-model).

**Time filtering:** the dashboard date-range control emits `dateFrom`/`dateTo` (`YYYY-MM-DD`). Filter `billing_records.period` between `dateFrom.slice(0,7)` and `dateTo.slice(0,7)` — the exact pattern the fraud route already uses. Trend/sparklines become **monthly** (period-grained); acceptable and noted.

**Currency:** `computeRow` outputs PKR. This aligns the KPIs with the already-PKR working-capital / cash-position tiles → the whole dashboard becomes PKR-consistent. (The current `useAdjustedSummary` USD-conversion path — which re-derived from `by-partner` — is removed; base currency handling is revisited so figures render consistently.)

## 5. Endpoint changes

Re-point (data source `transactions`+`campaigns` → `billing_records` + `computeRow`); **response shapes stay the same** so the frontend hooks/widgets are unaffected:

| Endpoint | New basis |
|---|---|
| `analytics/dashboard` (summary + deltas) | Σ computeRow over billing_records; prior-period = prior month-span; `clientCount`/`platformCount` from billing_records distinct; replace `campaignCount` → `recordCount` (or buying-house count) |
| `analytics/profit-over-time` | group by `period`; revenue/cost/profit via computeRow |
| `analytics/by-client` | group by `clientId` |
| `analytics/by-platform` | group by `platformId` |
| `analytics/concentration` | client revenue shares via computeRow |
| `analytics/margin-distribution` | per-record margin (netMarginPkr/receivablePkr) |
| `analytics/matrix` | client × partner from billing_records (native) |
| `analytics/flow` (Sankey) | client → buying-house → partner (billing_records has all three) |
| `analytics/forecast` | monthly period series |
| `analytics/anomalies` | monthly period series |
| `analytics/alerts` | negative-margin billing_records (per client/partner/period) instead of campaign-profit |
| `lib/analytics/route-filters.ts` | filter on `billing_records` (period + clientId/platformId/buyingHouseId); drop the campaigns/transactions joins |
| `lib/ai-context.ts` | period deltas + top records from billing_records; remove transaction queries |

`analytics/quality/fraud`, `aging`, `cashflow`, `invoice-funnel`, `po-pacing`, `waterfall` already read the live model — **unchanged**.

## 6. Widget changes

All dashboard widgets are kept; most simply light up once the endpoints are re-pointed. Only these need reshaping (they list transaction rows today):

- **Recent Transactions** → **Recent billing records**: list latest `billing_records` (client · partner · period · receivable · margin%). Re-point from `useListTransactions` to `useListAllBillingRecords`.
- **Needs-Attention** → low/negative-margin `billing_records` (filter `netMarginPkr < 0` or `marginPct < threshold`). Re-point to `useListAllBillingRecords`.
- **Counts** → replace the "Campaigns" tile with a live metric (billing-record count, or Buying Houses).

Untouched (already live): Working Capital, Cash Flow, AR/AP Aging, Invoice Funnel, PO Pacing, Cash Position, Fraud Trend. Lit-up by re-point: all KPIs, Profit Trend, Client/Platform Performance, Concentration, Forecast, Anomaly, AI "What changed".

## 7. Deletion & drops (sequenced so nothing breaks)

Order matters — re-point first, delete code second, drop tables last.

1. **Re-point** all §5 endpoints + §6 widgets (they no longer import `transactionsTable`/`campaignsTable`).
2. **Delete dead code:** `app/app/api/transactions/route.ts` + `[id]/route.ts`; `app/app/api/bills/route.ts` + `[id]/route.ts`; transaction queries in `ai-context.ts`. (The `/transactions` **page** stays — it manages `billing_records`, not the dropped table.)
3. **Regenerate the API client** (`@workspace/api-zod` + `@workspace/api-client-react`) so `useListTransactions`/`useCreateTransaction`/`useListBills`/`useGetBill`/etc. are removed. Fix any now-dangling imports.
4. **Drop tables** via a new migration + `drizzle-kit push`, dependents first: `bill_transactions`, `payment_bills`, then `bills`; `transactions`, then `campaigns`. Remove their schema files + `schema/index.ts` exports + any zod/types. **Destructive and irreversible on the shared DB** — gated behind an explicit confirmation step in the plan, with a `pg_dump` of the 5 tables taken first.

## 8. Testing

- **Unit:** the re-point aggregation helpers (revenue/cost/profit from a set of billing_records via `computeRow`; period bucketing; prior-period month math; concentration/HHI on the new basis). `computeRow` itself is already covered.
- **API:** each re-pointed route test updated to mock `billing_records` and assert the same response shape with computed values; empty-data and date-range (period filter) cases; deltas non-null with two periods.
- **Regression:** full `vitest` suite green; `typecheck` clean; `next build` succeeds; grep shows **zero** references to `transactionsTable`/`campaignsTable`/`billsTable`/`billTransactionsTable`/`paymentBillsTable` outside their (deleted) schema files.
- **Data sanity:** with the current 5 billing_records, the dashboard KPIs render non-zero PKR figures.

## 9. Risks & rollback

- **Destructive drops** — mitigated by `pg_dump` of the 5 tables before dropping, and by making the drop the final, separately-confirmed step.
- **API client regeneration** may churn generated files broadly — do it in its own commit so the diff is reviewable and revertible.
- **Monthly granularity** for forecast/anomaly (period-based) is coarser than the old daily transactions; acceptable given the data model, noted for the user.
- **Shared DB** — the drops affect the same database the running app uses; schedule/confirm accordingly.

## 10. Phasing (single plan)

1. **Aggregation core:** a shared `billing-records-agg` module (pure) that turns filtered billing_records → revenue/cost/profit/margin by period/client/partner/buying-house via `computeRow`; unit-tested. Period-filter helper.
2. **Re-point read endpoints:** dashboard summary (+ deltas), profit-over-time, by-client, by-partner, route-filters; update their route tests.
3. **Re-point the rest:** concentration, margin-distribution, matrix, flow, forecast, anomalies, alerts, ai-context.
4. **Widgets:** reshape Recent-Transactions / Needs-Attention / Counts to billing_records; verify all widgets show real data (`next build`).
5. **Delete code + regen client:** remove transactions/bills routes + ai-context transaction queries; regenerate `@workspace/api-zod` + `@workspace/api-client-react`; fix imports.
6. **Drop tables (gated):** `pg_dump` the 5 tables; migration + push to drop them; delete schema files/exports; final green sweep.

## 11. Open questions

None blocking. Confirmed during design: revenue basis = `billing_records` via `computeRow`; keep all live widgets (re-point, don't remove); drop exactly `campaigns`, `transactions`, `bills`, `bill_transactions`, `payment_bills`; `billing_records` and `cost_resources` are LIVE and kept.
