# Dashboard Cockpit Redesign — Design

**Date:** 2026-07-21
**Status:** Approved (design)
**Scope decision:** Full redesign of the home Dashboard · keep the drag/drop grid · mixed/role-aware audience · per-account (DB-backed) persistence · single implementation plan, phased.

> **Relationship to prior work:** The 2026-07-11 "Dashboard & Analytics Redesign" spec planned both an executive **Dashboard cockpit** (§5) and a tabbed **Analytics workspace** (§6). The Analytics workspace shipped in full — four tabs backed by ~18 `/api/analytics/*` endpoints and a rich component library. **The Dashboard cockpit did not** — the home page still runs the pre-redesign grid with basic components. This spec finishes the cockpit, reusing the analytics component library and endpoints that already exist, and rebuilds the widget framework and persistence for a role-aware audience.

---

## 1. Problem & findings

The home Dashboard (`app/app/(dashboard)/page.tsx`, ~580 lines) reads as a generation behind the Analytics page it sits beside. Concrete findings:

1. **Dead trend data.** `app/app/api/analytics/dashboard/route.ts` hardcodes `revenueChange / profitChange / costChange: null`. Every KPI card's delta chip and up/down arrow is therefore invisible — the cards are flat by construction.
2. **Duplicate `KpiCard`.** An inline `KpiCard` lives in the dashboard page *and* a polished `app/components/analytics/KpiCard.tsx` exists — divergent styling.
3. **Basic visual vocabulary.** The dashboard only speaks area-chart + grouped-bars + table, while the analytics library already ships treemap, Sankey, waterfall, Pareto, margin quadrant, heatmap, anomaly, forecast, status funnel, PO burn-down, fraud trend, and an **AI insight strip** — none consumed by the dashboard.
4. **No time context.** Numbers are all-time and static; there is no period selector, so no "this month vs last."
5. **Rigid, inline widget wiring.** Widget visibility is a hand-maintained set of `activeWidgets.includes(id)` conditionals with a parallel `defaultLayout` array. Adding widgets means editing multiple places. Counts and Working Capital are always-on and un-removable — inconsistent with the widget model.
6. **Client-only persistence.** Layout and active-widget state live in `localStorage` (`adops-dashboard-layout`, `adops-dashboard-active-widgets`) — not tied to the account, so preferences do not follow a user across devices/browsers.
7. **No role-awareness.** All widgets are offered regardless of the user's permissions, even though roles are granular (`View Cost`, `View Payments`, `View Billings`, `View Analytics`, `View Purchase Orders`, …).

## 2. Goals & non-goals

**Goals**
- Rebuild the dashboard as a role-aware **executive cockpit** that reuses the analytics component library and endpoints — no new visualization primitives.
- Keep the `react-grid-layout` drag/drop grid, but make it **data-driven** via a widget registry with a shared widget shell and per-widget error boundaries.
- Make KPI deltas real (period comparison) and add a **compact date-range control** so the numbers move.
- Persist a user's dashboard **per-account in the DB**, migrating existing `localStorage` state once.
- Ship **role-gating** (widgets appear only when the user holds the permission) and **3 focus presets** (Exec / Ops / Finance) so a shared landing screen serves everyone.

**Non-goals**
- No new source-of-truth data entry — this is a read/aggregation layer over existing modules.
- No new analytics endpoints beyond extending `dashboard` for period comparison. All other widget data uses hooks that already exist.
- No new charting primitives — reuse `app/components/analytics/*`.
- Not replacing the Analytics workspace; deep exploration stays there.

## 3. Personas & priority

Shared landing screen; presets + role-gating serve all three without a per-persona page.

1. **Agency owner / exec:** P&L health, margin, cash position, concentration risk, "what changed."
2. **Ops / campaign managers:** PO pacing, underperformers, anomalies, alerts.
3. **Finance:** AR/AP aging, cash flow, invoice status.

## 4. Widget framework

### 4.1 Registry
Replace the inline conditional wiring with a typed registry — the single place a widget is declared:

```ts
type WidgetId = string;

interface WidgetDef {
  id: WidgetId;
  label: string;                 // Add-Widget palette
  description: string;           // Add-Widget palette
  category: "kpi" | "profitability" | "financial-ops" | "relationships" | "risk" | "activity";
  permission: string | null;     // role-gate; null = View Dashboard only
  defaultLayout: { w: number; h: number; minW: number; minH: number };
  Component: React.ComponentType;
}

const widgetRegistry: Record<WidgetId, WidgetDef>;
```

The grid renders from `activeWidgets.map(id => widgetRegistry[id])`. Adding a widget = one registry entry + its component. No more scattered conditionals or parallel `defaultLayout`.

### 4.2 Shared widget shell
A single `<DashboardWidget>` wrapper owns:
- Card chrome (`rounded-2xl border bg-card shadow-sm`), the drag handle (`.widget-drag-handle`), and the title row.
- Loading (skeleton), empty, and error states.
- A per-widget error boundary — **reuse `app/components/analytics/WidgetErrorBoundary.tsx`** — so one failing aggregation never blanks the grid.

Every widget component receives a normalized surface and renders its body only; the shell is consistent across all of them.

### 4.3 Role-gating
- The Add-Widget palette lists only widgets whose `permission` the current user holds (via `useHasPermission`; `System Admin`/system users hold all).
- On render, a widget whose permission is not held is skipped (defensive — covers a saved layout after a role change).
- `permission: null` widgets require only `View Dashboard` (the page-level guard already enforces it).

Permission mapping is defined per widget in §5.

## 5. Widget catalog

All widgets reuse existing components and hooks. "Reuses" = component under `app/components/analytics/`; "Hook" = generated hook in `@workspace/api-client-react`.

### 5.1 KPI tiles (`category: kpi`, reuse `analytics/KpiCard`)
| Widget | Hook | Gate |
|---|---|---|
| Net Revenue | `useGetDashboardSummary` | View Dashboard |
| Net Profit | `useGetDashboardSummary` | View Cost |
| Margin % | `useGetDashboardSummary` | View Cost |
| Total Cost | `useGetDashboardSummary` | View Cost |
| Cash Position | `useGetAging` / `useGetCashFlow` | View Payments |

Each tile shows value + **period delta** (from §6) + sparkline. Profit/Margin/Cost sit behind `View Cost` because they expose cost.

### 5.2 Profitability (`category: profitability`)
| Widget | Reuses | Hook | Gate |
|---|---|---|---|
| Profit + Revenue trend w/ forecast band | `ForecastChart` | `useGetProfitOverTime` + `useGetForecast` | View Dashboard |
| Profit-leakage waterfall | `WaterfallChart` | `useGetProfitWaterfall` | View Cost |
| Revenue × Margin quadrant | `MarginQuadrant` | `useGetAnalyticsByClient` | View Cost |
| Client performance (ported, restyled) | bar | `useGetAnalyticsByClient` | View Clients |
| Platform performance (ported, restyled) | bar | `useGetAnalyticsByPartner` | View Partners |

### 5.3 Financial operations (`category: financial-ops`)
| Widget | Reuses | Hook | Gate |
|---|---|---|---|
| Working Capital (AR vs AP + net gap) | upgrade existing panel | `useGetAging` | View Payments |
| Cash-flow timeline (in/out) | `CashFlowChart` | `useGetCashFlow` | View Payments |
| AR / AP aging | `AgingBars` | `useGetAging` | View Payments |
| Invoice status funnel | `StatusFunnel` | `useGetInvoiceFunnel` | View Billings |
| PPO pacing / at-risk | `PoBurnDownChart` | `useGetPoPacing` | View Purchase Orders |

### 5.4 Relationships & concentration (`category: relationships`)
| Widget | Reuses | Hook | Gate |
|---|---|---|---|
| Revenue concentration (Top-5 Pareto + HHI) | `ParetoChart` | `useGetConcentration` | View Analytics |
| Revenue mix treemap | `RevenueTreemap` | `useGetMarginMatrix` (`matrix.cells`) | View Analytics |

### 5.5 Risk & quality (`category: risk`)
| Widget | Reuses | Hook | Gate |
|---|---|---|---|
| AI "What changed" strip | `AiInsightStrip` | `useGetAiInsights` | View Analytics |
| Upgraded Alerts (neg-margin, overdue, PPO overspend, fraud) | existing panel | `useGetAlerts` | View Dashboard |
| Anomaly watch | `AnomalyChart` | `useGetAnomalies` | View Analytics |
| Traffic quality / fraud trend | `FraudTrendChart` | `useGetFraudQuality` | View Analytics |

### 5.6 Activity (`category: activity`)
| Widget | Hook | Gate |
|---|---|---|
| Needs-attention (loss / low-margin transactions) | `useListTransactions` | View Transactions |
| Recent transactions (ported, modernized) | `useListTransactions` | View Transactions |
| Counts (Clients / Platforms / Campaigns) | `useGetDashboardSummary` | View Dashboard |

**Duplicate removal:** delete the inline `KpiCard` in the dashboard page; all KPI tiles use `app/components/analytics/KpiCard.tsx`.

## 6. KPI truth + time context

- **Extend `GET /api/analytics/dashboard`** to compute a prior-period comparison and return real `revenueChange / profitChange / costChange` (and a margin delta) instead of `null`. Prior period = the immediately preceding window of equal length to the selected range (default: current calendar month vs previous). Reuse the existing `percentDelta` / `marginPct` helpers in `app/lib/analytics/metrics.ts`.
- **Compact date-range control** in the dashboard header: presets **MTD · Last 30 · QTD · YTD · Custom**. The selection feeds `useGetDashboardSummary`, `useGetProfitOverTime`, and any range-aware widget via query params already supported by those endpoints (`dateFrom`, `dateTo`). This is a lightweight control, **not** the full analytics `FilterBar`.
- Sparklines on KPI tiles are driven by `useGetProfitOverTime` series (as today) but bound to the selected range.

## 7. Per-account persistence

### 7.1 Schema
New drizzle table (follows `roles.permissions` `jsonb` pattern), file `lib/db/src/schema/dashboard-layouts.ts`, exported from `lib/db/src/schema/index.ts`, migration `lib/db/migrations/0006_dashboard_layouts.sql`:

```
dashboard_layouts
  id            serial primary key
  user_id       integer not null references users(id)  -- unique: one row per user
  active_widgets jsonb  not null   -- WidgetId[]
  layout         jsonb  not null   -- react-grid-layout layouts object (per breakpoint)
  preset         text   null       -- last-applied preset id, if any
  created_at     timestamptz not null default now()
  updated_at     timestamptz not null default now()
```

### 7.2 Endpoint
`app/app/api/me/dashboard-layout/route.ts`:
- `GET` → the current session user's row (or `null`), behind `requireAuth`.
- `PUT` → upsert the current user's row from `{ activeWidgets, layout, preset }`, validated with a `@workspace/api-zod` schema.
- No `userId` in the body — always derived from the session (a user can only read/write their own layout).

### 7.3 Client wiring & migration
- Replace the `localStorage.setItem` calls with a React Query mutation to `PUT /api/me/dashboard-layout`; read via `GET`.
- **One-time migration:** on first load, if the server returns no row but `localStorage` holds `adops-dashboard-layout` / `adops-dashboard-active-widgets`, PUT that state to the server, then clear the local keys and read from the server thereafter.
- Saves are debounced on `onLayoutChange` / widget toggle to avoid a PUT per drag frame.

## 8. Focus presets

Three named starter widget sets (a `WidgetId[]` + layout each), applied via a "Focus" control in the header. Applying a preset replaces `activeWidgets`/`layout`; the user can then drag freely. Preset contents are filtered by the user's permissions on apply.

- **Exec:** Net Revenue · Net Profit · Margin % · Cash Position KPIs · AI "What changed" · Profit+forecast trend · Revenue concentration · Working Capital · Upgraded Alerts.
- **Ops:** KPI strip · PPO pacing/at-risk · Needs-attention · Platform performance · Anomaly watch · Upgraded Alerts.
- **Finance:** Cash Position KPI · Working Capital · Cash-flow timeline · AR/AP aging · Invoice status funnel · Recent transactions.

The shipped **default** (new user, no saved row) is the **Exec** preset filtered by permissions.

## 9. States & resilience

- Every widget: skeleton (loading), empty ("No data yet"), and error states via the shared shell.
- Per-widget `WidgetErrorBoundary` isolates failures.
- Widgets whose permission is not held are never mounted.
- `dataviz` skill invoked at build time so any new palette/encoding choices read as one system in light and dark themes (consistent with the analytics build).

## 10. Files touched (indicative)

- `app/app/(dashboard)/page.tsx` — rebuilt around the registry + shared shell; inline `KpiCard` deleted.
- `app/components/dashboard/` (new) — `DashboardWidget` shell, `widget-registry.ts`, `presets.ts`, and per-widget wrappers that adapt analytics components to the shell.
- `app/app/api/analytics/dashboard/route.ts` — real period deltas.
- `app/app/api/me/dashboard-layout/route.ts` (new) — GET/PUT.
- `lib/db/src/schema/dashboard-layouts.ts` (new) + `schema/index.ts` export + `lib/db/migrations/0006_dashboard_layouts.sql`.
- `@workspace/api-zod` — request/response schema for the layout endpoint (+ dashboard delta fields already present in the response type).

## 11. Testing

- **Unit:** registry integrity (every `activeWidgets` id resolves; every widget declares a permission + default layout); preset contents reference valid ids; the dashboard delta computation (prior-period math, divide-by-zero → null).
- **API:** `dashboard` route returns non-null deltas with two periods of data and null-safe deltas with one; `me/dashboard-layout` GET/PUT round-trips and refuses to touch another user's row (session-scoped).
- **Component:** dashboard renders with a saved layout, with no saved row (falls back to Exec preset), and with a layout containing a now-forbidden widget (skipped, no crash). Role-gating hides gated widgets from the palette.

## 12. Phasing (single plan, sequenced)

1. **Framework** — registry + `<DashboardWidget>` shell + `WidgetErrorBoundary` + role-gating + DB persistence (table, migration, endpoint, localStorage migration). Port the existing widgets (KPIs, counts, profit chart, alerts, working capital, client/platform, transactions) into the registry. No visible feature loss.
2. **KPI truth** — real period deltas in the dashboard endpoint + compact date-range header; delete the duplicate `KpiCard`.
3. **Insight widgets** — AI strip, revenue concentration, profit+forecast band, upgraded alerts, anomaly watch.
4. **Financial-ops widgets** — cash-flow timeline, AR/AP aging, invoice status funnel, PPO pacing, Cash Position KPI.
5. **Presets + polish** — 3 focus presets, revenue-mix treemap, margin quadrant, profit-leakage waterfall, fraud trend, needs-attention table, `dataviz` palette pass, empty/loading/error polish.

## 13. Open questions

None blocking. Decisions locked during design:
- Keep the `react-grid-layout` drag/drop grid (not a fixed/curated layout).
- Persist per-account in the DB (not localStorage).
- Ship the full catalog; presets + role-gating curate what any one user sees.
- Include the compact date-range control (required to make deltas meaningful).