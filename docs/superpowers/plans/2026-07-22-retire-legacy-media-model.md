# Retire Legacy "Media" Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-point the dashboard/analytics "Media" layer from the empty `transactions`/`campaigns` tables to the live `billing_records` model (via `computeRow`), delete the orphaned `transactions` + `bills` code, and drop 5 stale tables — so the dashboard shows real numbers.

**Architecture:** `computeRow(record)` (pure, `app/lib/compute-row.ts`) turns one `billing_records` row into PKR `receivablePkr`/`totalPayablePkr`/`netMarginPkr`. A new pure aggregation module fetches filtered `billing_records`, maps `computeRow`, and aggregates by `period`/`clientId`/`platformId`/`buyingHouseId` — the same pattern the buying-house analytics already uses. Each re-pointed endpoint keeps its **response shape** (so the frontend + generated client are unaffected), swapping only the data source. Deletion of routes + tables happens last, after nothing references them.

**Tech Stack:** Next.js 15 API routes, Drizzle ORM (`drizzle-kit push`), Vitest (node), orval codegen (`lib/api-spec/openapi.yaml` → `@workspace/api-zod` + `@workspace/api-client-react`).

---

## Conventions (read once)

- **Worktree:** this plan runs in an isolated git worktree off `feat/analytics-redesign` (the branch that holds the dashboard cockpit). Set it up per superpowers:using-git-worktrees; copy the real `.env` + `app/.env` into the worktree (untracked) so the DB is reachable; `pnpm install`.
- **Run one test:** from `app/`: `./node_modules/.bin/vitest run <path>` (the `pnpm --filter @workspace/web exec vitest` form can fail to resolve the bin in some shells).
- **Typecheck:** `pnpm --filter @workspace/web typecheck` (or `npx tsc -p tsconfig.json --noEmit` from `app/`).
- **Build (integration proxy — no jsdom/render tests exist):** `pnpm --filter @workspace/web build`.
- **Codegen:** `pnpm --filter @workspace/api-spec codegen` (orval, `clean:true`, then typechecks libs). Only run in Phase 5.
- **DB apply:** `pnpm --filter @workspace/db push`. **Do not** blind-`push` mid-plan; the only schema change is the final drop (Phase 6).
- **`computeRow` output** per record: `receivablePkr` (revenue), `totalPayablePkr` (cost), `netMarginPkr` (profit). All PKR.
- **`billing_records` columns:** `id, platformId, buyingHouseId, clientId, costModelId, period ("YYYY-MM"), appsflyerPins, fraudPins, payoutRate, marginPct, forexSellingRate, forexBuyingRate, salesTaxPct, remittanceTaxPct, withholdingTaxPct, bulkDiscountPct, platformBulkDiscountPct, createdAt`.
- **Commits:** conventional; commit per task.

## File structure

**Created**
- `app/lib/analytics/billing-records-agg.ts` (+ `.test.ts`) — pure aggregation over computeRow.
- `app/lib/analytics/record-filters.ts` (+ `.test.ts`) — billing_records where-conditions (period + id filters).

**Modified (re-point; response shapes unchanged)**
- `app/app/api/analytics/dashboard/route.ts` (+ test), `profit-over-time`, `by-client`, `by-platform`, `concentration`, `margin-distribution`, `matrix`, `flow`, `forecast`, `anomalies`, `alerts` route files (+ their tests).
- `app/lib/ai-context.ts`.
- `app/components/dashboard/widgets/{RecentTransactions,NeedsAttention,Counts}.tsx`, `app/lib/dashboard/use-adjusted-summary.ts`.

**Deleted (Phase 5-6)**
- `app/app/api/transactions/route.ts` + `[id]/route.ts`; `app/app/api/bills/route.ts` + `[id]/route.ts`.
- `lib/api-spec/openapi.yaml` paths + regen.
- `lib/db/src/schema/{campaigns,transactions,bills,bill-transactions,payment-bills}.ts` + `schema/index.ts` exports; migration `0007_drop_legacy_media.sql`.

---

# Phase 1 — Aggregation core (pure, TDD)

### Task 1: `billing-records-agg.ts`

**Files:** Create `app/lib/analytics/billing-records-agg.ts`; Test `app/lib/analytics/billing-records-agg.test.ts`

- [ ] **Step 1: Write the failing test**
```ts
import { describe, it, expect } from "vitest";
import { aggregateTotals, aggregateBy, type AggRecord } from "./billing-records-agg";

// Minimal record: computeRow inputs + dimensions. marginPct 20 => receivable > payable.
const rec = (over: Partial<AggRecord> = {}): AggRecord => ({
  clientId: 1, platformId: 1, buyingHouseId: 1, period: "2026-06",
  appsflyerPins: 100, fraudPins: 0, payoutRate: "1", marginPct: "20",
  forexSellingRate: "1", forexBuyingRate: "1", salesTaxPct: "0",
  remittanceTaxPct: "0", withholdingTaxPct: "0", bulkDiscountPct: "0", platformBulkDiscountPct: "0",
  ...over,
});

describe("aggregateTotals", () => {
  it("sums computeRow revenue/cost/profit and derives margin", () => {
    const t = aggregateTotals([rec(), rec()]);
    // per record: netAmtUsd=100, receivable=125 (100/0.8), payable=80 (100*0.8) => profit 45
    expect(t.revenue).toBeCloseTo(250);
    expect(t.cost).toBeCloseTo(160);
    expect(t.profit).toBeCloseTo(90);
    expect(t.marginPct).toBeCloseTo(36); // 90/250*100
  });
  it("returns zeros (margin 0) for empty input", () => {
    expect(aggregateTotals([])).toEqual({ revenue: 0, cost: 0, profit: 0, marginPct: 0 });
  });
});

describe("aggregateBy", () => {
  it("groups by a key function", () => {
    const g = aggregateBy([rec({ clientId: 1 }), rec({ clientId: 2 }), rec({ clientId: 1 })], (r) => r.clientId);
    expect(g.get(1)!.revenue).toBeCloseTo(250);
    expect(g.get(2)!.revenue).toBeCloseTo(125);
  });
});
```

- [ ] **Step 2: Run it → FAIL** (`./node_modules/.bin/vitest run lib/analytics/billing-records-agg.test.ts` from `app/`).

- [ ] **Step 3: Implement**
```ts
import { computeRow, type ComputeRowInput } from "@/lib/compute-row";

export interface AggRecord extends ComputeRowInput {
  clientId: number | null;
  platformId: number;
  buyingHouseId: number;
  period: string;
}
export interface Totals { revenue: number; cost: number; profit: number; marginPct: number }

export function aggregateTotals(records: AggRecord[]): Totals {
  let revenue = 0, cost = 0, profit = 0;
  for (const r of records) {
    const c = computeRow(r);
    revenue += c.receivablePkr; cost += c.totalPayablePkr; profit += c.netMarginPkr;
  }
  return { revenue, cost, profit, marginPct: revenue > 0 ? (profit / revenue) * 100 : 0 };
}

export function aggregateBy<K>(records: AggRecord[], keyFn: (r: AggRecord) => K): Map<K, Totals> {
  const groups = new Map<K, AggRecord[]>();
  for (const r of records) {
    const k = keyFn(r);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  const out = new Map<K, Totals>();
  for (const [k, recs] of groups) out.set(k, aggregateTotals(recs));
  return out;
}
```

- [ ] **Step 4: Run → PASS. Step 5: Commit** `feat(analytics): billing-records aggregation via computeRow`.

### Task 2: `record-filters.ts`

**Files:** Create `app/lib/analytics/record-filters.ts`; Test `.test.ts`

- [ ] **Step 1: Failing test**
```ts
import { describe, it, expect } from "vitest";
import { monthOf } from "./record-filters";

describe("monthOf", () => {
  it("maps an ISO date to its YYYY-MM period", () => {
    expect(monthOf("2026-06-15")).toBe("2026-06");
    expect(monthOf(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** (`billing_records` has `period` text + native `clientId`/`platformId`/`buyingHouseId`, so no joins needed):
```ts
import { gte, inArray, lte, type SQL } from "drizzle-orm";
import { billingRecordsTable } from "@workspace/db/schema";

export function monthOf(d: string | null | undefined): string | null {
  return d ? d.slice(0, 7) : null;
}

export interface RecordFilterParams {
  dateFrom?: string | null; dateTo?: string | null;
  clientIds?: number[]; partnerIds?: number[]; buyingHouseIds?: number[];
}

export function buildRecordConditions(p: RecordFilterParams): SQL[] {
  const conditions: SQL[] = [];
  const from = monthOf(p.dateFrom), to = monthOf(p.dateTo);
  if (from) conditions.push(gte(billingRecordsTable.period, from));
  if (to) conditions.push(lte(billingRecordsTable.period, to));
  if (p.clientIds?.length) conditions.push(inArray(billingRecordsTable.clientId, p.clientIds));
  if (p.partnerIds?.length) conditions.push(inArray(billingRecordsTable.platformId, p.partnerIds));
  if (p.buyingHouseIds?.length) conditions.push(inArray(billingRecordsTable.buyingHouseId, p.buyingHouseIds));
  return conditions;
}
```

- [ ] **Step 4: Run → PASS. Step 5: Commit** `feat(analytics): billing_records filter conditions`.

---

# Phase 2 — Re-point the primary read endpoints

Pattern for every re-pointed route: build conditions with `buildRecordConditions`, `db.select().from(billingRecordsTable).where(and(...conditions))`, then aggregate with the Phase-1 module, then shape the **existing** response. Update each route's test to mock `billing_records` rows and assert the same shape with computed values.

### Task 3: `dashboard` summary

**Files:** Modify `app/app/api/analytics/dashboard/route.ts` + `route.test.ts`

- [ ] **Step 1: Update the test** to mock `billing_records` rows (computeRow inputs + dimensions) instead of the transactions aggregate, asserting `totalRevenue/totalCost/totalProfit/marginPct` equal the `computeRow` sums, `clientCount`/`platformCount` = distinct ids, and (with a supplied `dateFrom/dateTo`) non-null deltas vs the prior month-span. Keep asserting deltas are `null` without a range.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Reimplement the route:**
  - Fetch current-window records: `const recs = await db.select().from(billingRecordsTable).where(cur.length ? and(...cur) : undefined)` where `cur = buildRecordConditions({dateFrom,dateTo,clientIds,partnerIds,buyingHouseIds})`.
  - `const totals = aggregateTotals(recs as AggRecord[])`.
  - Counts: `clientCount = new Set(recs.map(r=>r.clientId).filter(Boolean)).size`, `platformCount = new Set(recs.map(r=>r.platformId)).size`, `transactionCount = recs.length` (now = record count), `campaignCount = 0` (field retained for shape; removed in Phase 5).
  - Deltas: when `dateFrom && dateTo`, compute prior window = the equal-length month span before `monthOf(dateFrom)` (reuse `priorRange` on the dates, then `monthOf`), fetch+aggregate, `percentDelta`.
  - Return the existing `GetDashboardSummaryResponse` shape with these values.

- [ ] **Step 4: Run → PASS. Step 5: Commit** `feat(analytics): dashboard summary from billing_records`.

### Task 4: `route-filters.ts` consumers → `profit-over-time`, `by-client`, `by-platform`

**Files:** Modify `app/app/api/analytics/{profit-over-time,by-client,by-platform}/route.ts` + their tests.

- [ ] **profit-over-time** — group records by `period`; each point `{ date: period, revenue, cost, profit }` from `aggregateBy(recs, r=>r.period)`, sorted by period. Update test to mock records across two periods.
- [ ] **by-client** — `aggregateBy(recs, r=>r.clientId)`, join client names (`clientsTable`) + buying-house name; response `{ clientId, clientName, buyingHouse?, revenue, cost, profit, marginPct, transactionCount: recordCountForClient }`. Keep field names.
- [ ] **by-platform** — `aggregateBy(recs, r=>r.platformId)`, join partner names; same shape as today (`platformName`, revenue/cost/profit/marginPct).
- [ ] Each: build conditions via `buildRecordConditions`; drop the `campaignsTable`/`transactionsTable` imports/joins. Run each test → PASS. Commit per route (`feat(analytics): <route> from billing_records`).

---

# Phase 3 — Re-point the remaining analytics + AI

Same fetch→aggregate pattern; response shapes unchanged. One task per route (+ test), commit each.

- [ ] **Task 5: `concentration`** — client revenue shares from `aggregateBy(recs, r=>r.clientId)`; recompute HHI/top-N on the new totals. Shape unchanged.
- [ ] **Task 6: `margin-distribution`** — per-record margin = `computeRow(r).netMarginPkr / receivablePkr * 100` (guard 0); histogram buckets as today.
- [ ] **Task 7: `matrix`** — client × partner grid: `aggregateBy(recs, r=>`${r.clientId}:${r.platformId}`)`; cells `{ clientName, partnerName, revenue, marginPct }` as the current `MatrixCell` shape expects.
- [ ] **Task 8: `flow`** — Sankey client → buying-house → partner using native `clientId`/`buyingHouseId`/`platformId` on records; same node/link response shape.
- [ ] **Task 9: `forecast`** — monthly `period` series of profit (or revenue) via `aggregateBy(recs, r=>r.period)`; feed the existing forecast helper. Note monthly granularity.
- [ ] **Task 10: `anomalies`** — same monthly series into the existing anomaly helper; same response.
- [ ] **Task 11: `alerts`** — replace campaign-profit alerts with negative/low-margin `billing_records`: for each record `computeRow`, flag `netMarginPkr < 0` (critical) or `marginPct < threshold` (warning); map to the existing `Alert` shape (`{ id, severity, type, message, label?, campaignName? }` — populate `label` with client/partner/period, leave `campaignName` undefined/omitted).
- [ ] **Task 12: `ai-context.ts`** — replace the transaction sum + top-campaign queries with billing_records period totals (`aggregateTotals`) + top records; keep the returned context shape the AI chat expects.

Each task: update/ add route test where one exists (`by-*`, `profit-over-time` have tests; add minimal ones for others only if trivial), `typecheck`, commit.

---

# Phase 4 — Widgets

### Task 13: Reshape transaction-bound widgets + verify all light up

**Files:** Modify `RecentTransactions.tsx`, `NeedsAttention.tsx`, `Counts.tsx`, `use-adjusted-summary.ts`.

- [ ] **use-adjusted-summary.ts** — the summary now returns PKR. Remove the `by-partner` USD re-derivation; return the summary figures directly and format as PKR (base currency handling: display PKR consistently — set the KPI `formatMoney(value, "PKR")` or drop the currency arg so it uses the summary's PKR). Keep the delta/sparkline wiring.
- [ ] **RecentTransactions.tsx** → **Recent billing records:** swap `useListTransactions` for `useListAllBillingRecords({})`; columns Client · Partner · Period · Receivable · Margin% (map from the record + `computeRow` client-side, or from fields the endpoint already returns). Title "Recent Billing Records".
- [ ] **NeedsAttention.tsx** → filter `useListAllBillingRecords` to `netMarginPkr < 0 || marginPct < 10`; same table styling; empty "Nothing needs attention".
- [ ] **Counts.tsx** → show Clients / Platforms / **Records** (use `clientCount`/`platformCount`/`transactionCount`); remove the Campaigns tile.
- [ ] **Verify:** `pnpm --filter @workspace/web typecheck`, full `vitest`, and `pnpm --filter @workspace/web build` succeed. With the 5 live billing_records, confirm (dev server, one manual check) the KPIs render non-zero PKR.
- [ ] Commit `feat(dashboard): point widgets at billing_records`.

---

# Phase 5 — Delete dead routes + regenerate client

### Task 14: Remove transactions/bills endpoints + openapi + regen

**Files:** Delete `app/app/api/transactions/route.ts` + `[id]/route.ts`, `app/app/api/bills/route.ts` + `[id]/route.ts`; edit `lib/api-spec/openapi.yaml`; regen.

- [ ] **Step 1:** Delete the 4 route files.
- [ ] **Step 2:** In `lib/api-spec/openapi.yaml` remove the paths `/transactions`, `/transactions/{id}`, `/bills`, `/bills/{id}` and any now-unreferenced request/response schemas they solely used (e.g. `CreateTransactionBody`, `Transaction`, bill detail/summary schemas). Also drop `campaignCount` from the dashboard summary response schema and rename `transactionCount`→`recordCount` there and in the by-client response (optional but do it here while regenerating). If you rename, update the route handlers + `Counts`/by-client widgets accordingly.
- [ ] **Step 3:** `pnpm --filter @workspace/api-spec codegen` — regenerates `@workspace/api-zod` + `@workspace/api-client-react` (removes `useListTransactions`/`useCreateTransaction`/`useListBills`/`useGetBill`, etc.) and typechecks libs.
- [ ] **Step 4:** Fix any now-dangling imports in `app/` (grep for the removed hook names; the `/transactions` **page** uses `useListAllBillingRecords`, not the removed hooks, so it stays). `typecheck` + full `vitest` + `build` green.
- [ ] **Step 5:** Commit `chore(api): remove transactions/bills endpoints + regen client` (regen in the same commit so the diff is self-contained).

---

# Phase 6 — Drop the stale tables (gated, destructive)

### Task 15: Backup + drop 5 tables

**Files:** Create `lib/db/migrations/0007_drop_legacy_media.sql`; delete 5 schema files; edit `schema/index.ts`.

- [ ] **Step 1 (backup):** `pg_dump` the 5 tables to a local file first:
  `pg_dump "$DATABASE_URL" -t campaigns -t transactions -t bills -t bill_transactions -t payment_bills --data-only -f ./legacy-media-backup.sql` (or a node `pg` COPY if `pg_dump` isn't available). Confirm the file has the rows.
- [ ] **Step 2 (confirm):** This step is destructive and irreversible on the shared DB — proceed only on explicit go-ahead from the controller/user.
- [ ] **Step 3:** Write `lib/db/migrations/0007_drop_legacy_media.sql` (record) dropping in FK-dependency order:
  ```sql
  DROP TABLE IF EXISTS "bill_transactions";
  DROP TABLE IF EXISTS "payment_bills";
  DROP TABLE IF EXISTS "bills";
  DROP TABLE IF EXISTS "transactions";
  DROP TABLE IF EXISTS "campaigns";
  ```
- [ ] **Step 4:** Remove `lib/db/src/schema/{campaigns,transactions,bills,bill-transactions,payment-bills}.ts` and their `export *` lines in `schema/index.ts`. Grep the repo to confirm **zero** remaining references to `campaignsTable`/`transactionsTable`/`billsTable`/`billTransactionsTable`/`paymentBillsTable` outside deleted files.
- [ ] **Step 5:** Apply: `pnpm --filter @workspace/db push` (drizzle will now drop the 5 tables since they're gone from the schema — review its plan, confirm it targets exactly these 5, no others).
- [ ] **Step 6:** `pnpm --filter @workspace/web typecheck` + full `vitest` + `build` green; verify the dashboard still loads and KPIs render.
- [ ] **Step 7:** Commit `feat(db): drop legacy media tables (campaigns, transactions, bills chain)`.

---

## Self-review notes (author)

- **Spec coverage:** §4 metric re-point → Tasks 1-3; §5 endpoints → Tasks 3-12; §6 widgets → Task 13; §7 delete/regen → Task 14; §7 drops → Task 15. Fraud/aging/cashflow/funnel/pacing/waterfall untouched (already live) — correctly out of scope.
- **Non-breaking ordering:** response shapes preserved through Phases 2-4 (transactionCount repurposed as record count, campaignCount=0), so no codegen until Phase 5; drops last (Phase 6). Deletion only after re-point removes all reads.
- **Type/name consistency:** `AggRecord`/`Totals`/`aggregateTotals`/`aggregateBy` defined in Task 1 used throughout; `buildRecordConditions`/`monthOf` from Task 2; every route imports `computeRow` from `@/lib/compute-row` (existing, tested).
- **Risk gates:** `pg_dump` before drop (Task 15 Step 1); explicit confirmation before the destructive push (Step 2); `build` as the render proxy each widget phase.
- **Verify during impl:** exact response field names of each analytics endpoint (`MatrixCell`, `Alert`, concentration `points/hhi/top5Pct`, forecast `history/forecast`) against `@workspace/api-zod` — keep them identical so the frontend widgets need no change beyond Task 13.
