# Dashboard & Analytics Redesign — Design

**Date:** 2026-07-11
**Status:** Approved (design) · re-grounded 2026-07-11 after the import engine shipped
**Scope decision:** Both surfaces as one coherent system · exec-first persona · all four insight domains · predictive/AI first-class · single implementation plan covering all phases.

> **Revision (import engine):** The import engine landed, adding canonical financial-ops tables: `partner_bills` (partner invoices, explicit USD `amount`), `partner_payments` (settlements, `status` pending|settled, `sourceClientPaymentId` funding link), `payment_billings` (client payment → billing collections), `partner_purchase_order_items` (PPO line budgets), and `tax_settings` (single global tax row). **`partner_bills`/`partner_payments` is the canonical AP source of truth**; the older `billing_records → bills → payment_bills` chain is retained only for the fraud-quality view. Financial Ops (§6 Tab 2, §7) is re-grounded on these tables and the prior open questions (§12) are resolved.

---

## 1. Context & the reframe

The AdOps Intelligence Platform is a media-buying intermediary: revenue comes from **clients** (Client POs → Billings/Invoices), cost goes to **partners/platforms** (Partner POs → Bills → Payments), sometimes routed through **buying houses**, on performance/event deals, with **cost models** underneath.

Today the home Dashboard (`app/app/(dashboard)/page.tsx`) and Analytics page (`app/app/(dashboard)/analytics/page.tsx`) both read **only the `transactions` table** (`spend` → revenue, `cost`, `profit`). That surfaces roughly a fifth of the money model. The rest is dark:

- **Two revenue engines exist, not one.** *Media* (`transactions`) **and** *Performance/Events* (`billing_event_items`: `billableRate × eventCount` vs `payoutRate × eventCount`). The events engine has no visualization today.
- **Margin leakage is measurable stage by stage** via `billings`/`billing_records`: FX spread (`forexSellingRate` vs `forexBuyingRate`), three taxes (`remittanceTaxPct`, `salesTaxPct`, `withholdingTaxPct`), and bulk discounts.
- **A full financial-ops layer is unused:** receivables (`billings` invoices ← `payment_billings` collections), payables (`partner_bills` ← `partner_payments`), PPO budget pacing (`partner_purchase_order_items.lineBudget` over `partner_purchase_orders.startDate→endDate`), and traffic quality / fraud (`fraudPins / appsflyerPins` in `billing_records`).

The existing AI module (`app/app/api/ai/chat/route.ts`, Groq + `lib/ai-context`) makes AI-narrated insights realistic to wire in.

**This redesign surfaces the P&L that is currently invisible, not merely "more charts."**

## 2. Goals & non-goals

**Goals**
- One coherent system: a curated executive **Dashboard cockpit** and a tabbed **Analytics workspace** sharing filters, currency, and visual language.
- Make the **Media / Performance / Combined** revenue-engine distinction a first-class, global concept.
- Deliver the four insight domains: Profitability & Margin, Financial Operations, Relationships & Concentration, Forecast & Anomalies.
- Reuse existing billing/payments computation as the single source of truth for financial numbers — never re-derive and risk divergence.

**Non-goals**
- No new source-of-truth data entry; this is a read/aggregation layer over existing modules.
- No heavyweight ML pipeline. Forecasting and anomaly detection use simple, explainable statistical methods.
- Not replacing the billing/payments modules' own detail screens.

## 3. Personas & priority

1. **Agency owner / exec (primary):** P&L health, margin, cash position, concentration risk, "what changed." Optimized for on the Dashboard cockpit and the top of each Analytics tab.
2. **Ops / campaign managers (secondary):** PO pacing, margin leakage, underperformers, fraud spikes, alerts.
3. **Finance (secondary):** AR/AP, aging, cash flow, invoice/payment status, DSO/DPO.

## 4. Shared foundation

Built once; consumed by both surfaces.

### 4.1 Global filter bar
Sticky on Analytics; compact variant on the Dashboard.

| Filter | Behavior | Source |
|---|---|---|
| **Date range** | Presets (MTD, QTD, YTD, Last 30/90) + custom; **Compare-to** toggle (previous period / previous year) | `transactions.date`, `billings.period` |
| **Revenue engine** | `Media` · `Performance` · `Combined` — switches which tables feed every view | `transactions` vs `billing_event_items` |
| **Client / Partner / Buying House** | Multi-select | `clients`, `partners`, `buying_houses` |
| **Cost model / Event** | Multi-select | `cost_models`, `client_events` |
| **Purchase order** | CPO/PPO picker (drives pacing views) | `client_purchase_orders`, `partner_purchase_orders` |
| **Status** (financial views) | Paid / Pending / Overdue / Dispute | `billings.status` (AR), `partner_payments.status` (AP) |
| **Currency** | Base currency + FX rates | settings store (§4.4) |

### 4.2 Comparison mode
When "Compare-to" is on, every KPI shows a delta and every trend chart overlays the comparison period (ghosted line). Deltas are `(current − prior) / prior`.

### 4.3 Drill-down & saved views
- **Drill-down:** clicking a bar/segment/cell applies it as a filter (e.g., click a client in the Pareto → whole workspace scopes to that client); a secondary action links to the source record (invoice, PO, bill).
- **Saved views:** persist a filter combination. Phase-1 storage is `localStorage`; a DB-backed store is a later enhancement.

### 4.4 Currency store
Formalize today's ad-hoc `localStorage` (`adops-base-currency`, `adops-exchange-rates`) into a single typed store surfaced in Settings, read by both surfaces. Conversion helper is centralized (currently duplicated in both pages).

### 4.5 States & resilience
- Every widget has skeleton (loading), empty, and error states.
- **Per-widget error boundary:** one failing aggregation never blanks a whole page/tab.
- All new pages remain behind `PermissionGuard` (`View Analytics` / `View Dashboard`); a finer `View Financial Analytics` permission is optional and noted, not required for v1.

## 5. Dashboard — executive cockpit

Curated, opinionated default (existing show/hide is retained, but this is the shipped default layout), top-to-bottom by priority:

1. **KPI strip** — Net Revenue · Net Profit · Margin %, each with a period delta **and a sparkline** (today's cards have no trend indication). The **Cash Position** tile joins the strip in Phase 2, when the financial-ops aggregations exist.
2. **Working-capital panel** (Phase 2) — Receivables vs Payables with a **net liquidity gap**, plus a compact "money in / money out — next 30 days" timeline.
3. **Profit trend + forecast band** — area chart with a dashed projection and a confidence ribbon.
4. **Concentration & risk** — "Top 5 clients = X% of revenue" mini-Pareto, alongside an **upgraded Alerts panel**: negative margin, overdue invoices, PPO overspend, and fraud spikes (today's alerts are campaign-profit-only).
5. **AI "What changed this week" strip** — 3–4 auto-generated insight cards (e.g., "Client X margin −8pts, driven by FX spread") from the Groq module over computed period deltas.

## 6. Analytics workspace — four tabs

Shared global filter bar at top; tabs below. Each chart is chosen so its form matches the question it answers.

### Tab 1 · Profitability & Margin
| Insight | Chart | Reads |
|---|---|---|
| Where does gross margin leak to net? | **Profit-leakage waterfall**: Gross revenue → − partner payouts → − FX spread → − taxes → − discounts → Net | billing rates/taxes/discounts, event items |
| High-revenue but low-margin accounts | **Revenue × Margin bubble quadrant** (bubble size = volume) | per client/partner aggregates |
| Margin health & outliers | **Margin distribution histogram** with the negative-margin tail highlighted | `billing_event_items` / `transactions` |
| Engine comparison over time | **Composed area**: Media vs Performance profit | both engines |

### Tab 2 · Financial Operations
| Insight | Chart | Reads |
|---|---|---|
| What's owed to us, and how old? | **AR aging stacked bars** (0–30 / 31–60 / 61–90 / 90+) | `billings` (netReceivable) − `payment_billings.amountApplied`; age from `invoiceGeneratedAt` |
| What we owe, and how old? | **AP aging stacked bars** | `partner_bills.amount` − settled `partner_payments.amount`; age from `dateReceived` |
| Liquidity over time | **Cash-flow timeline** (collections in vs payouts out, running balance) + funded-vs-unfunded payout cut | in: client `payments` via `payment_billings`; out: settled `partner_payments`; funding via `sourceClientPaymentId` |
| Invoice lifecycle | **Status funnel**: pending → approved → invoiced → paid/partial | `billings.status` × collection state from `payment_billings` |
| Are PPOs pacing to budget? | **PPO burn-down**: cumulative actual vs ideal pace vs projected exhaustion date | consumed = Σ `partner_bills.amount` for the PPO vs Σ `partner_purchase_order_items.lineBudget` over `startDate→endDate` |

### Tab 3 · Relationships & Concentration
| Insight | Chart | Reads |
|---|---|---|
| Concentration risk (80/20) | **Revenue Pareto** (bars + cumulative % line) + HHI index | client aggregates |
| How money flows through the chain | **Sankey: Clients → Buying Houses → Partners** | campaigns/billings joins |
| Best/worst client–partner combinations | **Client × Partner margin heatmap** | cross aggregates |
| Revenue composition at a glance | **Treemap** (client → partner nested) | aggregates |
| Traffic quality by platform | **Fraud-rate trend** (`fraudPins/appsflyerPins`) with a threshold band | `billing_records` |

### Tab 4 · Forecast & Anomalies (predictive)
| Insight | Chart | Method |
|---|---|---|
| Where are revenue / cash headed? | **Forecast line + confidence ribbon** | trailing linear regression / seasonal-naive |
| What broke from the pattern? | **Anomaly-flagged time series** (markers on outliers) | rolling z-score / IQR |
| Why did it change? | **AI narrative cards** | Groq over computed deltas |
| What if FX / discount / payout changes? | **What-if margin simulator** (sliders → recomputed net) | billing formula, client-side |

## 7. Metric definitions (grounded)

All confirmed against the schema after the import-engine re-grounding.

- **Media revenue / cost / profit** = `Σ transactions.spend` / `Σ transactions.cost` / `Σ transactions.profit`.
- **Performance gross revenue** = `Σ (billing_event_items.billableRate × eventCount)`.
- **Performance gross cost** = `Σ (billing_event_items.payoutRate × eventCount)`.
- **Net invoice / receivable value** = `computeBilling()` (`app/lib/compute-billing.ts`) → `netReceivable`; the leakage waterfall reuses its intermediate fields (`totalInvoice → lessWht → lessSst → lessBd → netReceivable → netPayablePkr → netMargin`). Never re-implemented.
- **Margin %** = `profit / revenue`.
- **Concentration**: revenue share of top N clients; **HHI** = `Σ(share_i²)`.
- **AR outstanding** (per billing) = `netReceivable` − `Σ payment_billings.amountApplied`.
- **AR aging bucket**: age = today − `billings.invoiceGeneratedAt`, bucketed 0–30 / 31–60 / 61–90 / 90+ (raw document-date aging; net-terms due dates are a later enhancement).
- **AP outstanding** (per partner bill) = `partner_bills.amount` − `Σ partner_payments.amount` where `status = 'settled'`; `pending` payments reported separately as "in transit."
- **AP aging bucket**: age = today − `partner_bills.dateReceived` (fallback `createdAt`), same buckets.
- **Cash flow**: money-in = client `payments` applied via `payment_billings`; money-out = settled `partner_payments`; a payout is **funded** when `sourceClientPaymentId` is set, **unfunded** otherwise.
- **PPO pacing**: consumed = `Σ partner_bills.amount` where `partnerPurchaseOrderId = PPO`; budget = `Σ partner_purchase_order_items.lineBudget` (== `partner_purchase_orders.totalBudget`); ideal pace = `budget × (elapsed days / total days)` over `startDate→endDate`; projected exhaustion by linear extrapolation of the consumed rate.
- **Fraud rate** = `fraudPins / appsflyerPins`; valid pins = `appsflyerPins − fraudPins` (from `billing_records`).
- **Forward-looking tax** (what-if simulator) reads the single `tax_settings` row; historical billings use their snapshotted rates.
- **FX spread** is embedded in `computeBilling`: receivable uses `forexSellingRate`, payable uses `forexBuyingRate`; the spread contribution is the delta between those two legs.

## 8. API & data flow

- **Existing endpoints extended** to accept the full filter set (`clientIds`, `partnerIds`, `buyingHouseIds`, `costModelId`, `poId`, `engine`, `compare`): `dashboard`, `by-client`, `by-platform`, `profit-over-time`, `alerts`.
- **New endpoints** under `/api/analytics/*`: `waterfall`, `distribution`, `aging` (AR+AP), `cashflow`, `po-pacing`, `concentration`, `flow` (Sankey), `matrix`, `quality/fraud`, `forecast`, `anomalies`, `ai-insights`.
- Query params validated with the existing `@workspace/api-zod` pattern; responses typed the same way and wired through `@workspace/api-client-react` hooks.
- **Metric formulas are pure functions** in a shared module — the single source of truth and the primary unit-test target.

## 9. Charting & libraries
- `recharts` (already in use) covers ~90%: area, bar, line, composed, scatter/bubble, stacked, and native **Sankey** and **Treemap**.
- **Waterfall** = composed bars with a transparent base series.
- **Heatmap** = a small custom CSS grid (no native recharts heatmap).
- **Gauge / DSO-DPO** = `RadialBarChart`.
- The **dataviz** skill is invoked at build time so palettes/encodings read as one system in light and dark themes.

## 10. Performance
- Proper DB indexes on the join/filter columns; React Query caching on the client.
- Upstash Redis (already present) for short-TTL caching of the heaviest aggregates.
- A nightly materialized summary is a fallback only if direct queries prove too slow — not built preemptively.

## 11. Testing
- **Unit:** Vitest tests on every metric pure function (waterfall stages, aging buckets, pacing, concentration/HHI, forecast, anomaly flags).
- **API:** route tests for each new endpoint (filters, empty data, auth).
- **Component:** smoke tests that each tab renders with sample and empty data.

## 12. Open questions — resolved by the import engine
1. ~~AR collections source~~ → **`payment_billings`** (client `payments` → `billings`, `amountApplied`).
2. ~~Bill amount derivation~~ → **`partner_bills.amount`** is an explicit USD column.
3. ~~Net invoice value~~ → **`computeBilling()`** is the canonical source (see §7).
4. ~~Payment terms → due dates~~ → **avoided**; aging uses raw document-date buckets, so `payment_terms` net-days is not required (a later enhancement).
5. ~~PPO actual attribution~~ → **`partner_bills.partnerPurchaseOrderId`** attributes actuals to a PPO.

Residual (decision, not a blocker): `partner_payments.status` values are `pending | settled`; outstanding AP counts only `settled`, pending shown as "in transit."

## 13. Phasing (internal structure of the single implementation plan)
Delivered as one plan, sequenced so value ships progressively and risky joins are validated early:
- **Phase 0 — Foundation:** filter bar + query contract, engine toggle, currency store, comparison mode, drill-down, error boundaries; refactor existing endpoints.
- **Phase 1 — Profitability tab + cockpit KPIs:** two-engine KPIs (deltas + sparklines), profit trend, leakage waterfall, margin quadrant/distribution.
- **Phase 2 — Financial Ops tab + working-capital panel:** AR/AP aging (`partner_bills`/`partner_payments` + `payment_billings`), cash-flow timeline with funded/unfunded cut, invoice status funnel, PPO burn-down. Fully specified — no discovery gate.
- **Phase 3 — Relationships tab:** Pareto/HHI, Sankey, client×partner heatmap, treemap, fraud quality.
- **Phase 4 — Forecast & Anomalies + AI:** forecast bands, anomaly markers, AI "what changed" strip, what-if simulator.