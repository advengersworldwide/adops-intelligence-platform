# Dashboard & Analytics Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Dashboard as a curated executive cockpit and Analytics as a tabbed, filter-driven workspace that surfaces the full P&L (both revenue engines, margin leakage, financial ops, relationships, and a predictive/AI layer).

**Architecture:** OpenAPI-first. Every endpoint is declared in `lib/api-spec/openapi.yaml`, then orval generates the zod schemas (`@workspace/api-zod`) and React Query hooks (`@workspace/api-client-react`). Route handlers live in `app/app/api/analytics/*` and delegate all financial math to pure, unit-tested functions in `app/lib/analytics/*`, reusing the canonical `app/lib/compute-billing.ts`. UI reads a shared `AnalyticsFilterContext` and renders with `recharts`.

**Tech Stack:** Next.js 15 (App Router, RSC + client components), Drizzle ORM (`@workspace/db`), orval codegen, zod, TanStack Query, recharts 3.x, Radix UI, Tailwind v4, Vitest (node env, `**/*.test.ts`).

---

## Conventions (read once)

- **Codegen loop for any endpoint:** edit `lib/api-spec/openapi.yaml` → run `pnpm --filter @workspace/api-spec codegen` → generated files appear under `lib/api-zod/src/generated` and `lib/api-client-react/src/generated`. **Never hand-edit generated files** (`clean: true` wipes them).
- **Route handler shape:** `export const runtime = "nodejs";` + `export async function GET(req: Request)`, parse with the generated `GetXQueryParams.safeParse(Object.fromEntries(new URL(req.url).searchParams))`, return `NextResponse.json(GetXResponse.parse(payload))`.
- **Array query params** are passed as comma-separated strings (`clientIds=1,2,3`) and parsed in-route to `number[]` — `Object.fromEntries` drops repeated keys, so do not use repeated params.
- **Tests:** Vitest only picks up `**/*.test.ts` in `node` env. Put logic in `.ts` pure functions and test those + route handlers. Do **not** write `.test.tsx`; chart components are verified by `pnpm --filter @workspace/web typecheck` and manual/browse QA.
- **Money math** always routes through `app/lib/compute-billing.ts` (`computeBilling`) or `app/lib/analytics/*` helpers — never inline formulas in routes or components.
- **Run tests:** `pnpm --filter @workspace/web test -- <path>`. **Typecheck:** `pnpm --filter @workspace/web typecheck`.
- **Commit** after every green step (messages shown per task).

> **Fidelity note:** Phase 0 and Phase 1 are specified at full step-level detail and are the first shippable increment (foundation + exec cockpit KPIs + Profitability tab). Phases 2–4 are specified as task-level breakdowns with files, reuse targets, tests, and acceptance criteria; their step-level code is finalized just-in-time because their exact SQL/response shapes depend on the AR/AP semantics resolved in **Task 2.0** (a required discovery task before Phase 2 code). This keeps the plan honest rather than guessing joins.

---

# PHASE 0 — Shared foundation

## Task 0.1: Centralized currency module

**Files:**
- Create: `app/lib/analytics/currency.ts`
- Test: `app/lib/analytics/currency.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/lib/analytics/currency.test.ts
import { describe, it, expect } from "vitest";
import { convertTo, formatMoney, DEFAULT_RATES } from "./currency";

describe("currency", () => {
  it("converts from a currency to base using rate division", () => {
    // 92 EUR at rate 0.92 => 100 base
    expect(convertTo(92, "EUR", { ...DEFAULT_RATES, eur: 0.92 })).toBeCloseTo(100, 6);
  });
  it("returns the amount unchanged for an unknown currency", () => {
    expect(convertTo(50, "XYZ", DEFAULT_RATES)).toBe(50);
  });
  it("formats compact money with a currency prefix", () => {
    expect(formatMoney(1500, "USD")).toBe("$1.5K");
    expect(formatMoney(-2_000_000, "USD")).toBe("-$2.0M");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/web test -- app/lib/analytics/currency.test.ts`
Expected: FAIL — `Cannot find module './currency'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/lib/analytics/currency.ts
// Single source of truth for FX conversion + compact money formatting.
// Consolidates the convert()/fmt() logic previously duplicated in
// app/app/(dashboard)/page.tsx and analytics/page.tsx.

export type Rates = Record<string, number>;

export const DEFAULT_RATES: Rates = {
  usd: 1.0, eur: 0.92, gbp: 0.79, inr: 83.0, jpy: 155.0,
  cad: 1.36, aud: 1.5, pkr: 278.0, sar: 3.75, aed: 3.67,
};

/** Convert `amount` expressed in `from` currency into base currency. */
export function convertTo(amount: number, from: string, rates: Rates): number {
  const rate = rates[(from || "USD").toLowerCase()];
  return rate && rate > 0 ? amount / rate : amount;
}

export function formatMoney(n: number, currency = "USD"): string {
  const prefix = currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : `${currency} `;
  const neg = n < 0;
  const abs = Math.abs(n);
  const val = abs >= 1_000_000 ? `${(abs / 1_000_000).toFixed(1)}M`
    : abs >= 1_000 ? `${(abs / 1_000).toFixed(1)}K`
    : abs.toFixed(0);
  return `${neg ? "-" : ""}${prefix}${val}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/web test -- app/lib/analytics/currency.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/analytics/currency.ts app/lib/analytics/currency.test.ts
git commit -m "feat(analytics): centralized currency conversion + formatting module"
```

## Task 0.2: Delta / sparkline metric helpers

**Files:**
- Create: `app/lib/analytics/metrics.ts`
- Test: `app/lib/analytics/metrics.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/lib/analytics/metrics.test.ts
import { describe, it, expect } from "vitest";
import { percentDelta, marginPct } from "./metrics";

describe("metrics", () => {
  it("computes percent delta vs prior", () => {
    expect(percentDelta(120, 100)).toBeCloseTo(20, 6);
    expect(percentDelta(80, 100)).toBeCloseTo(-20, 6);
  });
  it("returns null delta when prior is zero (undefined growth)", () => {
    expect(percentDelta(50, 0)).toBeNull();
  });
  it("computes margin percent, guarding divide-by-zero", () => {
    expect(marginPct(30, 100)).toBeCloseTo(30, 6);
    expect(marginPct(30, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/web test -- app/lib/analytics/metrics.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/lib/analytics/metrics.ts
/** Percent change of current vs prior. Null when prior is 0 (growth undefined). */
export function percentDelta(current: number, prior: number): number | null {
  if (prior === 0) return null;
  return ((current - prior) / prior) * 100;
}

/** profit / revenue as a percent, 0 when revenue is 0. */
export function marginPct(profit: number, revenue: number): number {
  return revenue > 0 ? (profit / revenue) * 100 : 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/web test -- app/lib/analytics/metrics.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/analytics/metrics.ts app/lib/analytics/metrics.test.ts
git commit -m "feat(analytics): delta and margin metric helpers"
```

## Task 0.3: Analytics filter param builder

**Files:**
- Create: `app/lib/analytics/filters.ts`
- Test: `app/lib/analytics/filters.test.ts`

The filter state is shared by every widget. `buildAnalyticsParams` turns the UI filter state into the query object the generated hooks expect. Keeping it pure makes it testable without React.

- [ ] **Step 1: Write the failing test**

```ts
// app/lib/analytics/filters.test.ts
import { describe, it, expect } from "vitest";
import { buildAnalyticsParams, type AnalyticsFilters } from "./filters";

const base: AnalyticsFilters = {
  dateFrom: "2026-01-01", dateTo: "2026-03-31",
  engine: "combined", clientIds: [], partnerIds: [], buyingHouseIds: [],
  costModelId: null, poId: null, status: null, compare: false,
};

describe("buildAnalyticsParams", () => {
  it("omits empty arrays and null values", () => {
    expect(buildAnalyticsParams(base)).toEqual({
      dateFrom: "2026-01-01", dateTo: "2026-03-31", engine: "combined", compare: false,
    });
  });
  it("serializes id arrays as comma-separated strings", () => {
    expect(buildAnalyticsParams({ ...base, clientIds: [1, 2, 3] }).clientIds).toBe("1,2,3");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/web test -- app/lib/analytics/filters.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/lib/analytics/filters.ts
export type RevenueEngine = "media" | "performance" | "combined";
export type FinancialStatus = "paid" | "pending" | "overdue" | "dispute";

export interface AnalyticsFilters {
  dateFrom: string;
  dateTo: string;
  engine: RevenueEngine;
  clientIds: number[];
  partnerIds: number[];
  buyingHouseIds: number[];
  costModelId: number | null;
  poId: number | null;
  status: FinancialStatus | null;
  compare: boolean;
}

/** Build the query object for the generated analytics hooks, omitting empties. */
export function buildAnalyticsParams(f: AnalyticsFilters): Record<string, string | boolean> {
  const p: Record<string, string | boolean> = {
    dateFrom: f.dateFrom, dateTo: f.dateTo, engine: f.engine, compare: f.compare,
  };
  if (f.clientIds.length) p.clientIds = f.clientIds.join(",");
  if (f.partnerIds.length) p.partnerIds = f.partnerIds.join(",");
  if (f.buyingHouseIds.length) p.buyingHouseIds = f.buyingHouseIds.join(",");
  if (f.costModelId != null) p.costModelId = String(f.costModelId);
  if (f.poId != null) p.poId = String(f.poId);
  if (f.status != null) p.status = f.status;
  return p;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/web test -- app/lib/analytics/filters.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/analytics/filters.ts app/lib/analytics/filters.test.ts
git commit -m "feat(analytics): pure filter-to-query param builder"
```

## Task 0.4: Server-side query-param parsing helper

**Files:**
- Create: `app/lib/analytics/parse-params.ts`
- Test: `app/lib/analytics/parse-params.test.ts`

Route handlers need the inverse: parse comma-separated ids and the engine back out.

- [ ] **Step 1: Write the failing test**

```ts
// app/lib/analytics/parse-params.test.ts
import { describe, it, expect } from "vitest";
import { parseIdList, parseEngine } from "./parse-params";

describe("parse-params", () => {
  it("parses a comma-separated id list, dropping non-numbers", () => {
    expect(parseIdList("1,2,x,3")).toEqual([1, 2, 3]);
    expect(parseIdList(null)).toEqual([]);
    expect(parseIdList("")).toEqual([]);
  });
  it("defaults engine to combined for invalid input", () => {
    expect(parseEngine("media")).toBe("media");
    expect(parseEngine("bogus")).toBe("combined");
    expect(parseEngine(null)).toBe("combined");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/web test -- app/lib/analytics/parse-params.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/lib/analytics/parse-params.ts
import type { RevenueEngine } from "./filters";

export function parseIdList(raw: string | null | undefined): number[] {
  if (!raw) return [];
  return raw.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
}

export function parseEngine(raw: string | null | undefined): RevenueEngine {
  return raw === "media" || raw === "performance" ? raw : "combined";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @workspace/web test -- app/lib/analytics/parse-params.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/analytics/parse-params.ts app/lib/analytics/parse-params.test.ts
git commit -m "feat(analytics): server-side query param parsing helpers"
```

## Task 0.5: AnalyticsFilterContext + provider

**Files:**
- Create: `app/hooks/use-analytics-filters.tsx`

React context holding `AnalyticsFilters` + setters, seeded with a sensible default range (last 90 days). No unit test (context wrapper); verified by typecheck and downstream use.

- [ ] **Step 1: Implement the provider**

```tsx
// app/hooks/use-analytics-filters.tsx
"use client";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { AnalyticsFilters, RevenueEngine, FinancialStatus } from "@/lib/analytics/filters";

function defaultRange(): { dateFrom: string; dateTo: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 90);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { dateFrom: iso(from), dateTo: iso(to) };
}

const defaultFilters: AnalyticsFilters = {
  ...defaultRange(),
  engine: "combined", clientIds: [], partnerIds: [], buyingHouseIds: [],
  costModelId: null, poId: null, status: null, compare: false,
};

interface Ctx {
  filters: AnalyticsFilters;
  setFilters: (patch: Partial<AnalyticsFilters>) => void;
  reset: () => void;
}
const AnalyticsFilterContext = createContext<Ctx | null>(null);

export function AnalyticsFilterProvider({ children }: { children: ReactNode }) {
  const [filters, setState] = useState<AnalyticsFilters>(defaultFilters);
  const value = useMemo<Ctx>(() => ({
    filters,
    setFilters: (patch) => setState((f) => ({ ...f, ...patch })),
    reset: () => setState(defaultFilters),
  }), [filters]);
  return <AnalyticsFilterContext.Provider value={value}>{children}</AnalyticsFilterContext.Provider>;
}

export function useAnalyticsFilters(): Ctx {
  const ctx = useContext(AnalyticsFilterContext);
  if (!ctx) throw new Error("useAnalyticsFilters must be used within AnalyticsFilterProvider");
  return ctx;
}

export type { AnalyticsFilters, RevenueEngine, FinancialStatus };
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @workspace/web typecheck`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add app/hooks/use-analytics-filters.tsx
git commit -m "feat(analytics): shared filter context provider"
```

## Task 0.6: Per-widget error boundary

**Files:**
- Create: `app/components/analytics/WidgetErrorBoundary.tsx`

- [ ] **Step 1: Implement**

```tsx
// app/components/analytics/WidgetErrorBoundary.tsx
"use client";
import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props { children: ReactNode; title?: string }
interface State { hasError: boolean }

export class WidgetErrorBoundary extends Component<Props, State> {
  constructor(props: Props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError(): State { return { hasError: true }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full min-h-32 flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-card p-5 text-center">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          <p className="text-xs text-muted-foreground">
            {this.props.title ? `"${this.props.title}" failed to load` : "This widget failed to load"}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
```

- [ ] **Step 2: Typecheck & commit**

Run: `pnpm --filter @workspace/web typecheck` → PASS

```bash
git add app/components/analytics/WidgetErrorBoundary.tsx
git commit -m "feat(analytics): per-widget error boundary"
```

## Task 0.7: Add shared filter params to existing analytics endpoints (OpenAPI)

**Files:**
- Modify: `lib/api-spec/openapi.yaml` (analytics paths at lines ~711–818; add a reusable parameter component)

- [ ] **Step 1: Add a reusable parameter set + engine schema**

Under `components:` add a `parameters:` section (create if absent) with the shared analytics filters, and a `RevenueEngine` schema under `components/schemas`:

```yaml
# components/schemas — add:
    RevenueEngine:
      type: string
      enum: [media, performance, combined]

# components/parameters — add (create the `parameters:` key under components if it does not exist):
  parameters:
    Engine:
      name: engine
      in: query
      schema: { $ref: "#/components/schemas/RevenueEngine" }
    ClientIds:
      name: clientIds
      in: query
      description: Comma-separated client ids
      schema: { type: ["string", "null"] }
    PartnerIds:
      name: partnerIds
      in: query
      schema: { type: ["string", "null"] }
    BuyingHouseIds:
      name: buyingHouseIds
      in: query
      schema: { type: ["string", "null"] }
    CostModelId:
      name: costModelId
      in: query
      schema: { type: ["integer", "null"] }
    Compare:
      name: compare
      in: query
      schema: { type: ["boolean", "null"] }
```

- [ ] **Step 2: Reference the shared params on the four existing GET endpoints**

For `/analytics/dashboard`, `/analytics/profit-over-time`, `/analytics/by-client`, `/analytics/by-platform`, append to each `parameters:` list (keeping existing `dateFrom`/`dateTo`):

```yaml
        - { $ref: "#/components/parameters/Engine" }
        - { $ref: "#/components/parameters/ClientIds" }
        - { $ref: "#/components/parameters/PartnerIds" }
        - { $ref: "#/components/parameters/BuyingHouseIds" }
        - { $ref: "#/components/parameters/CostModelId" }
        - { $ref: "#/components/parameters/Compare" }
```

- [ ] **Step 3: Regenerate the client + zod**

Run: `pnpm --filter @workspace/api-spec codegen`
Expected: completes, then `pnpm -w run typecheck:libs` passes. New optional fields appear on `GetDashboardSummaryQueryParams` etc.

- [ ] **Step 4: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-zod lib/api-client-react
git commit -m "feat(analytics): declare shared filter params on analytics endpoints"
```

## Task 0.8: Apply filters + engine in the dashboard-summary route

**Files:**
- Modify: `app/app/api/analytics/dashboard/route.ts`
- Test: `app/app/api/analytics/dashboard/route.test.ts`

> Engine semantics: `media` = transactions only (current behavior); `performance` = event-based billings; `combined` = both. For Phase 0 wire `media` and `combined` (combined == media until Phase 1 adds the performance aggregation), and apply the client/partner/buyingHouse filters to the transactions aggregation. Performance revenue is layered in during Task 1.x.

- [ ] **Step 1: Write the failing test** (mirror `app/app/api/client-purchase-orders/route.test.ts` structure — import the `GET`, build a `Request` with a query string, assert JSON). Test that `clientIds` filters the transaction aggregation.

```ts
// app/app/api/analytics/dashboard/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@workspace/db", () => {
  const rows = { agg: { totalRevenue: "100", totalCost: "60", totalProfit: "40", transactionCount: 2 },
                 counts: { clientCount: 1, platformCount: 1, campaignCount: 1 } };
  return { db: { select: () => ({ from: () => ({ where: () => Promise.resolve([rows.agg]),
    leftJoin: () => ({ leftJoin: () => ({ where: () => Promise.resolve([rows.counts]) }) }) }) }) },
    transactionsTable: {}, campaignsTable: {}, clientsTable: {}, partnersTable: {} };
});

import { GET } from "./route";

describe("GET /api/analytics/dashboard", () => {
  beforeEach(() => vi.clearAllMocks());
  it("returns computed margin from aggregated rows", async () => {
    const res = await GET(new Request("http://t/api/analytics/dashboard?engine=media&clientIds=1"));
    const body = await res.json();
    expect(body.totalRevenue).toBe(100);
    expect(body.marginPct).toBeCloseTo(40, 6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/web test -- app/app/api/analytics/dashboard/route.test.ts`
Expected: FAIL (route doesn't yet read `clientIds`/`engine`; adjust the mock shape until the test exercises the new filter path and fails on behavior, not import).

- [ ] **Step 3: Implement** — extend the existing route ([app/app/api/analytics/dashboard/route.ts](app/app/api/analytics/dashboard/route.ts)) to parse `engine`, `clientIds`, `partnerIds`, `buyingHouseIds`, `costModelId` via `parseIdList`/`parseEngine`, and add `inArray` conditions joining `campaignsTable` when client/partner filters are present. Keep the existing `dateFrom`/`dateTo` conditions.

- [ ] **Step 4: Run test to verify it passes** → PASS

- [ ] **Step 5: Commit**

```bash
git add app/app/api/analytics/dashboard/route.ts app/app/api/analytics/dashboard/route.test.ts
git commit -m "feat(analytics): filter dashboard summary by engine, client, partner, buying house"
```

## Task 0.9: Apply the same filters to profit-over-time, by-client, by-platform routes

**Files:**
- Modify: `app/app/api/analytics/profit-over-time/route.ts`, `.../by-client/route.ts`, `.../by-platform/route.ts`
- Test: one `route.test.ts` per route asserting a client filter narrows results.

- [ ] **Step 1–4 (per route):** Repeat the Task 0.8 pattern — parse the shared params with the helpers, add `inArray` conditions on the campaign→client/partner joins, keep date grouping. Write a failing filter test, implement, verify pass.
- [ ] **Step 5: Commit**

```bash
git add app/app/api/analytics/profit-over-time app/app/api/analytics/by-client app/app/api/analytics/by-platform
git commit -m "feat(analytics): apply shared filters to time-series and breakdown routes"
```

## Task 0.10: Global FilterBar component

**Files:**
- Create: `app/components/analytics/FilterBar.tsx`

Uses existing UI primitives: `components/ui/input.tsx` (date), `components/ui/select.tsx`, `components/ui/popover.tsx`, `components/ui/button.tsx`. Reads/writes `useAnalyticsFilters`. Renders: date range (from/to + preset buttons MTD/QTD/YTD/90d), the **engine segmented toggle** (Media/Performance/Combined), and multi-select popovers for Client/Partner/Buying House (options fetched via existing list hooks `useListClients`, `useListPartners`, `useListBuyingHouses`), a "Compare to previous" switch, and a Reset button.

- [ ] **Step 1:** Implement `FilterBar` (client component). Engine toggle sets `engine`; preset buttons compute ranges and call `setFilters`. Multi-selects push id arrays.
- [ ] **Step 2:** Typecheck → PASS
- [ ] **Step 3: Commit**

```bash
git add app/components/analytics/FilterBar.tsx
git commit -m "feat(analytics): global filter bar with engine toggle and presets"
```

---

# PHASE 1 — Profitability tab + cockpit KPIs

## Task 1.1: Waterfall aggregation function

**Files:**
- Create: `app/lib/analytics/waterfall.ts`
- Test: `app/lib/analytics/waterfall.test.ts`

Reuses `computeBilling` from [app/lib/compute-billing.ts](app/lib/compute-billing.ts). Each billing's `ComputeBillingResult` fields become waterfall stages; we sum stage-by-stage across billings.

- [ ] **Step 1: Write the failing test**

```ts
// app/lib/analytics/waterfall.test.ts
import { describe, it, expect } from "vitest";
import { buildWaterfall } from "./waterfall";
import { computeBilling, type ComputeBillingInput } from "@/lib/compute-billing";

const billing: ComputeBillingInput = {
  events: [{ eventCount: 100, billableRate: 5, payoutRate: 3 }],
  forexSellingRate: 280, forexBuyingRate: 275,
  remittanceTaxPct: 0, salesTaxPct: 0, withholdingTaxPct: 0, bulkDiscountPct: 0, whtApplied: false,
};

describe("buildWaterfall", () => {
  it("produces monotonic decreasing stages from total invoice to net margin", () => {
    const w = buildWaterfall([computeBilling(billing)]);
    const totalInvoice = w.find((s) => s.key === "totalInvoice")!.value;
    const netMargin = w.find((s) => s.key === "netMargin")!.value;
    expect(totalInvoice).toBeGreaterThan(netMargin);
    // 100*5*280 = 140000 invoice; payout 100*3*275 = 82500; margin 57500
    expect(totalInvoice).toBeCloseTo(140000, 2);
    expect(netMargin).toBeCloseTo(57500, 2);
  });
  it("sums stages across multiple billings", () => {
    const w = buildWaterfall([computeBilling(billing), computeBilling(billing)]);
    expect(w.find((s) => s.key === "totalInvoice")!.value).toBeCloseTo(280000, 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @workspace/web test -- app/lib/analytics/waterfall.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/lib/analytics/waterfall.ts
import type { ComputeBillingResult } from "@/lib/compute-billing";

export interface WaterfallStage {
  key: "totalInvoice" | "lessWht" | "lessSst" | "lessBd" | "netReceivable" | "partnerPayout" | "netMargin";
  label: string;
  value: number;   // absolute magnitude for this stage
  kind: "start" | "decrease" | "subtotal" | "total";
}

/** Aggregate per-billing compute results into ordered leakage stages (PKR). */
export function buildWaterfall(results: ComputeBillingResult[]): WaterfallStage[] {
  const sum = (f: (r: ComputeBillingResult) => number) => results.reduce((s, r) => s + f(r), 0);
  return [
    { key: "totalInvoice", label: "Total Invoice", value: sum((r) => r.totalInvoice), kind: "start" },
    { key: "lessWht", label: "− Withholding", value: sum((r) => r.lessWht), kind: "decrease" },
    { key: "lessSst", label: "− Sales Tax", value: sum((r) => r.lessSst), kind: "decrease" },
    { key: "lessBd", label: "− Bulk Discount", value: sum((r) => r.lessBd), kind: "decrease" },
    { key: "netReceivable", label: "Net Receivable", value: sum((r) => r.netReceivable), kind: "subtotal" },
    { key: "partnerPayout", label: "− Partner Payout", value: sum((r) => r.netPayablePkr), kind: "decrease" },
    { key: "netMargin", label: "Net Margin", value: sum((r) => r.netMargin), kind: "total" },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes** → PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add app/lib/analytics/waterfall.ts app/lib/analytics/waterfall.test.ts
git commit -m "feat(analytics): profit-leakage waterfall aggregation reusing compute-billing"
```

## Task 1.2: Waterfall endpoint (OpenAPI + route)

**Files:**
- Modify: `lib/api-spec/openapi.yaml` (add `/analytics/waterfall` path + `WaterfallStage` schema)
- Create: `app/app/api/analytics/waterfall/route.ts`
- Test: `app/app/api/analytics/waterfall/route.test.ts`

- [ ] **Step 1:** Add to `openapi.yaml`:

```yaml
  /analytics/waterfall:
    get:
      operationId: getProfitWaterfall
      tags: [analytics]
      summary: Profit-leakage waterfall stages (performance engine)
      parameters:
        - { $ref: "#/components/parameters/ClientIds" }
        - { $ref: "#/components/parameters/PartnerIds" }
        - name: period
          in: query
          schema: { type: ["string", "null"] }
      responses:
        "200":
          description: Ordered waterfall stages
          content:
            application/json:
              schema:
                type: array
                items: { $ref: "#/components/schemas/WaterfallStage" }
# schemas:
    WaterfallStage:
      type: object
      required: [key, label, value, kind]
      properties:
        key: { type: string }
        label: { type: string }
        value: { type: number }
        kind: { type: string, enum: [start, decrease, subtotal, total] }
```

- [ ] **Step 2:** Run codegen: `pnpm --filter @workspace/api-spec codegen` → PASS.
- [ ] **Step 3:** Write failing route test (mock `@workspace/db` to return one billing + its event items; assert 7 stages returned, `netMargin` last).
- [ ] **Step 4:** Implement `route.ts`: load billings (filtered) with their `billing_lines`→`billing_event_items`, map each to a `ComputeBillingInput` (rates/taxes/discounts from the billing row, events from its items), `computeBilling`, then `buildWaterfall`. Return `GetProfitWaterfallResponse.parse(stages)`.
- [ ] **Step 5:** Verify tests pass; commit:

```bash
git add lib/api-spec/openapi.yaml lib/api-zod lib/api-client-react app/app/api/analytics/waterfall
git commit -m "feat(analytics): profit-leakage waterfall endpoint"
```

## Task 1.3: WaterfallChart component

**Files:**
- Create: `app/components/analytics/charts/WaterfallChart.tsx`

Recharts `ComposedChart` with a transparent "base" bar (running offset) plus a visible "delta" bar; decrease stages red, subtotal/total emerald. Compute the floating base client-side from the stages array.

- [ ] **Step 1:** Implement (compute `base[]` cumulative offsets; render `<Bar dataKey="base" fill="transparent" stackId="a" />` + `<Bar dataKey="display" stackId="a" />` with per-cell colors via `<Cell>`). Run the **dataviz** skill first for palette/encoding.
- [ ] **Step 2:** Typecheck → PASS
- [ ] **Step 3: Commit**

```bash
git add app/components/analytics/charts/WaterfallChart.tsx
git commit -m "feat(analytics): waterfall chart component"
```

## Task 1.4: Margin distribution + revenue×margin quadrant

**Files:**
- Modify: `lib/api-spec/openapi.yaml` (add `/analytics/margin-distribution` → `MarginBucket`, and reuse existing `ClientAnalytics`/`PartnerAnalytics` for the quadrant scatter)
- Create: `app/lib/analytics/distribution.ts` (+ test) — `bucketMargins(values, binSize)` pure function
- Create: `app/app/api/analytics/margin-distribution/route.ts` (+ test)
- Create: `app/components/analytics/charts/MarginHistogram.tsx`, `app/components/analytics/charts/MarginQuadrant.tsx`

- [ ] **Step 1 (TDD pure fn):** Test `bucketMargins([-5, 3, 12, 45, 47], 10)` → buckets keyed by range with counts; negative-margin bucket flagged. Implement, verify pass, commit.
- [ ] **Step 2:** Add OpenAPI path + `MarginBucket` schema, codegen, commit.
- [ ] **Step 3:** Implement route (compute per-entity margin from transactions or event items depending on `engine`, bucket via `bucketMargins`), failing test → pass, commit.
- [ ] **Step 4:** Implement `MarginHistogram` (recharts `BarChart`, negative bucket red) and `MarginQuadrant` (recharts `ScatterChart`, X=revenue, Y=margin%, Z=volume via `ZAxis`, reference lines at median). Typecheck, commit.

## Task 1.5: Upgrade KPI card with delta + sparkline

**Files:**
- Create: `app/components/analytics/KpiCard.tsx` (extracted + upgraded from the inline `KpiCard` in [app/app/(dashboard)/page.tsx](app/app/(dashboard)/page.tsx))

- [ ] **Step 1:** Implement a reusable `KpiCard` that accepts `value`, `delta` (number|null), `positive`, `sparkline?: number[]`, and renders a compact recharts `AreaChart` sparkline under the value. Use `formatMoney` and `percentDelta` from Phase 0.
- [ ] **Step 2:** Typecheck → PASS
- [ ] **Step 3: Commit**

```bash
git add app/components/analytics/KpiCard.tsx
git commit -m "feat(analytics): KPI card with delta badge and sparkline"
```

## Task 1.6: Analytics workspace shell with tabs + Profitability tab

**Files:**
- Rewrite: `app/app/(dashboard)/analytics/page.tsx`
- Create: `app/components/analytics/tabs/ProfitabilityTab.tsx`

- [ ] **Step 1:** Wrap the page in `AnalyticsFilterProvider` + `PermissionGuard`, render `FilterBar` at top and a Radix `Tabs` (`components/ui/tabs.tsx`) with four triggers: **Profitability · Financial Ops · Relationships · Forecast** (last three render a "Coming in this rollout" placeholder panel until their phase lands — this is an intentional staged shell, not a stub of logic).
- [ ] **Step 2:** Build `ProfitabilityTab`: reads `useAnalyticsFilters` → `buildAnalyticsParams`, renders (each wrapped in `WidgetErrorBoundary`): two-engine KPI strip (`KpiCard` ×4 using `useGetDashboardSummary`), engine-aware profit trend (`useGetProfitOverTime`), `WaterfallChart` (`useGetProfitWaterfall`), `MarginQuadrant` + `MarginHistogram`.
- [ ] **Step 3:** Typecheck → PASS; manual/browse QA of the tab with the date/engine filters.
- [ ] **Step 4: Commit**

```bash
git add app/app/(dashboard)/analytics/page.tsx app/components/analytics/tabs/ProfitabilityTab.tsx
git commit -m "feat(analytics): tabbed workspace shell + Profitability tab"
```

## Task 1.7: Dashboard cockpit KPI strip

**Files:**
- Modify: `app/app/(dashboard)/page.tsx`

- [ ] **Step 1:** Replace the inline KPI widgets with the new `KpiCard` (delta + sparkline), feeding `revenueChange`/`profitChange`/`costChange` from `useGetDashboardSummary` and a sparkline series from `useGetProfitOverTime`. Keep the existing react-grid-layout show/hide, but ship the curated default (KPI strip → profit trend+forecast placeholder → concentration/alerts). Remove the now-duplicated `convert`/`fmt` in favor of `@/lib/analytics/currency`.
- [ ] **Step 2:** Typecheck → PASS; browse QA.
- [ ] **Step 3: Commit**

```bash
git add app/app/(dashboard)/page.tsx
git commit -m "feat(dashboard): executive KPI strip with deltas and sparklines"
```

---

# PHASE 2 — Financial Operations (task-level; step code finalized after Task 2.0)

## Task 2.0 (REQUIRED DISCOVERY — do first): confirm AR/AP semantics
Resolve spec §12 by reading the payments/billing modules and DB:
- How client **collections** are recorded (do `bills.clientId` rows represent receivables, or is collection tracked against `billings` some other way?).
- The `bills` **total amount** derivation (no amount column) from linked `billing_records` via `bill_transactions`.
- Whether `payment_terms.name` yields net-days for due dates, or a numeric field is needed (if needed, add a `netDays` column migration as its own task).

Write findings as a short `docs/superpowers/specs/2026-07-11-dashboard-analytics-redesign-design.md` update (append an "AR/AP resolution" section) and commit. **Phase 2 step code is written against these findings.**

## Task 2.1: AR/AP aging pure function + endpoint
- Create `app/lib/analytics/aging.ts` (+ test): `bucketByAge(items, asOf)` → `{ "0-30", "31-60", "61-90", "90+" }` totals. Reuse `computeBilling.netReceivable` for AR amounts and the confirmed bill-total formula for AP.
- Add `/analytics/aging` OpenAPI + route (returns AR and AP bucket sets). TDD the pure function; route test with mocked db.

## Task 2.2: Cash-flow timeline endpoint + chart
- `app/lib/analytics/cashflow.ts` (+ test): running-balance series from collections in (payments) and payouts out over the date range.
- `/analytics/cashflow` endpoint; `CashFlowChart` (recharts `ComposedChart`: bars in/out + running-balance line).

## Task 2.3: Invoice status funnel
- Aggregate `billings.status` counts/amounts (pending→approved→invoiced→paid). `/analytics/invoice-funnel` endpoint; `StatusFunnel` component (stacked horizontal bars).

## Task 2.4: PPO burn-down pacing
- `app/lib/analytics/pacing.ts` (+ test): `pace(consumed, totalBudget, start, end, asOf)` → `{ idealToDate, projectedExhaustion, overpacePct }`. Consumed = Σ event-item payout on billing_lines for the PPO (reuse `po-totals` where applicable).
- `/analytics/po-pacing` endpoint; `PoBurnDownChart` (actual cumulative vs ideal pace line vs projected).

## Task 2.5: Dashboard working-capital panel + Cash Position KPI
- Add the Receivables vs Payables + net-liquidity-gap panel and the **Cash Position** KPI tile to the cockpit, plus the FinancialOpsTab assembling 2.1–2.4.

---

# PHASE 3 — Relationships & Concentration (task-level)

## Task 3.1: Concentration (Pareto + HHI)
- `app/lib/analytics/concentration.ts` (+ test): sort clients by revenue, cumulative %, `hhi(shares)`. `/analytics/concentration` endpoint; `ParetoChart` (recharts `ComposedChart`: bars + cumulative % line, 80% reference line).

## Task 3.2: Money-flow Sankey
- `/analytics/flow` endpoint returning nodes+links for Clients→Buying Houses→Partners (amounts from billings). `FlowSankey` using recharts `Sankey`.

## Task 3.3: Client×Partner margin heatmap
- `/analytics/matrix` endpoint (grid of client×partner margin). `MarginHeatmap` custom CSS-grid component (color scale via the dataviz sequential palette).

## Task 3.4: Revenue treemap
- Reuse `by-client`/aggregate data; `RevenueTreemap` using recharts `Treemap` (client→partner nesting).

## Task 3.5: Fraud-quality trend
- `app/lib/analytics/fraud.ts` (+ test): `fraudRate(fraudPins, appsflyerPins)`, valid pins, per-period series from `billing_records`. `/analytics/quality/fraud` endpoint; `FraudTrendChart` (line + threshold band). Feed fraud-spike into Alerts.

## Task 3.6: RelationshipsTab + upgraded Alerts
- Assemble 3.1–3.5 into `RelationshipsTab`; extend `/analytics/alerts` to include overdue invoices, PPO overspend, and fraud spikes.

---

# PHASE 4 — Forecast & Anomalies + AI (task-level)

## Task 4.1: Forecast function + endpoint
- `app/lib/analytics/forecast.ts` (+ test): `forecast(series, horizon)` via trailing linear regression / seasonal-naive, returning point + lower/upper band. `/analytics/forecast` endpoint; overlay a dashed projection + confidence ribbon on the profit-trend and cockpit chart.

## Task 4.2: Anomaly detection
- `app/lib/analytics/anomalies.ts` (+ test): rolling z-score / IQR flags on a series. `/analytics/anomalies` endpoint; `AnomalyChart` (line with flagged markers).

## Task 4.3: AI insight strip
- `/analytics/ai-insights` route: compute period deltas (reuse Phase 0–3 aggregates), pass to Groq via the existing `lib/ai-context` + chat pattern ([app/app/api/ai/chat/route.ts](app/app/api/ai/chat/route.ts)), return 3–4 short narrative cards. Rate-limit as in the chat route. Render the "What changed this week" strip on the cockpit.

## Task 4.4: What-if margin simulator
- `WhatIfSimulator` component: sliders for FX selling/buying, discount, payout → live re-run of `computeBilling` client-side → net-margin readout + delta vs actual. No new endpoint (pure client compute).

## Task 4.5: ForecastTab
- Assemble 4.1, 4.2, 4.4 into `ForecastTab`; ensure the tab shell placeholders from Task 1.6 are replaced.

---

## Final self-review checklist (run before declaring done)
- [ ] Spec §4 filters → Tasks 0.3, 0.5, 0.10; §5 cockpit → 1.5, 1.7, 2.5, 4.3; §6 Tab 1 → 1.1–1.6; Tab 2 → 2.x; Tab 3 → 3.x; Tab 4 → 4.x; §7 formulas → the `app/lib/analytics/*` pure fns; §8 endpoints → each `/analytics/*` task; §11 testing → per-fn/per-route tests.
- [ ] Every new endpoint went through the codegen loop (openapi → codegen → route), no hand-edited generated files.
- [ ] No inline money math — all via `compute-billing` / `app/lib/analytics/*`.
- [ ] §12 open questions resolved in Task 2.0 before Phase 2 step code.