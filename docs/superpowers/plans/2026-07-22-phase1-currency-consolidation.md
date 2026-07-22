# Phase 1 — Currency Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the base display currency a real, DB-persisted setting (default **PKR**) that governs analytics/dashboard amounts, so PKR values never render a `$`, while event rates and partner bills/payments stay USD.

**Architecture:** Add `base_currency` to the existing `tax_settings` singleton (exposed through the already-generated `/tax-settings` endpoint), change `formatMoney`'s default currency from `USD` to `PKR`, expose the DB base currency via a `useBaseCurrency()` hook, and fix the handful of surfaces that still default to USD (CashFlowChart's localStorage read, the alert PPO line, KPI `$0` fallbacks, `use-adjusted-summary`). Full arbitrary-base conversion across every chart is intentionally **out of scope** — with PKR as the consistent default, the visible `$`-on-PKR bug is eliminated.

**Tech Stack:** Next.js (App Router), Drizzle ORM (Postgres), orval codegen (openapi.yaml → `@workspace/api-zod` + `@workspace/api-client-react`), React Query, Recharts, Vitest.

**Key commands (run from repo root unless noted):**
- Codegen: `pnpm --filter @workspace/api-spec codegen`
- DB schema push: `pnpm --filter @workspace/db push` (use `push-force` if it stalls on a prompt)
- Typecheck: `pnpm --filter @workspace/web typecheck`
- Unit test (single file): `cd app && pnpm exec vitest run <path-relative-to-app>`
- All app tests: `pnpm --filter @workspace/web test`

**Currency semantics (reference):** client invoices / receivables / client payments / analytics aggregates = **PKR**; partner bills / partner payments + event rates (`billableRate`/`payoutRate`) = **USD**. The global rate never re-derives stored amounts; per-record forex already lives on each row.

---

### Task 1: Add `base_currency` to the tax-settings table

**Files:**
- Modify: `lib/db/src/schema/tax-settings.ts`

- [ ] **Step 1: Add the column to the schema**

In `lib/db/src/schema/tax-settings.ts`, add a `baseCurrency` column (default `'PKR'`) to the `taxSettingsTable` definition, immediately after `withholdingTaxPct`:

```ts
export const taxSettingsTable = pgTable("tax_settings", {
  id: serial("id").primaryKey(),
  remittanceTaxPct: numeric("remittance_tax_pct", { precision: 6, scale: 2 }).notNull(),
  salesTaxPct: numeric("sales_tax_pct", { precision: 6, scale: 2 }).notNull(),
  withholdingTaxPct: numeric("withholding_tax_pct", { precision: 6, scale: 2 }).notNull(),
  baseCurrency: text("base_currency").notNull().default("PKR"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});
```

Add `text` to the existing `drizzle-orm/pg-core` import at the top (it currently imports `pgTable, serial, numeric, timestamp`):

```ts
import { pgTable, serial, numeric, timestamp, text } from "drizzle-orm/pg-core";
```

- [ ] **Step 2: Push the schema to the database**

Run: `pnpm --filter @workspace/db push`
Expected: drizzle-kit reports adding column `base_currency` to `tax_settings` and applies it. If it prompts and stalls, cancel and run `pnpm --filter @workspace/db push-force`.

- [ ] **Step 3: Commit**

```bash
git add lib/db/src/schema/tax-settings.ts
git commit -m "feat(db): add base_currency to tax_settings (default PKR)"
```

---

### Task 2: Expose `baseCurrency` through the API schema + regenerate the client

**Files:**
- Modify: `lib/api-spec/openapi.yaml:3013-3028`

- [ ] **Step 1: Add `baseCurrency` to the `TaxSettings` and `TaxSettingsInput` schemas**

Replace the Tax Settings schema block (lines ~3013–3028) with:

```yaml
    # ── Tax Settings ──────────────────────────────────────────────────────────────
    TaxSettings:
      type: object
      required: [id, remittanceTaxPct, salesTaxPct, withholdingTaxPct, baseCurrency]
      properties:
        id: { type: integer }
        remittanceTaxPct: { type: number }
        salesTaxPct: { type: number }
        withholdingTaxPct: { type: number }
        baseCurrency: { type: string }
    TaxSettingsInput:
      type: object
      properties:
        remittanceTaxPct: { type: number }
        salesTaxPct: { type: number }
        withholdingTaxPct: { type: number }
        baseCurrency: { type: string }
```

Note: `TaxSettingsInput` no longer marks the three tax fields as `required` — this enables partial updates (the base-currency selector saves `baseCurrency` alone; the tax card saves the tax fields alone). The PUT handler (Task 3) merges provided fields over current values.

- [ ] **Step 2: Regenerate the API client + zod schemas**

Run: `pnpm --filter @workspace/api-spec codegen`
Expected: orval regenerates `lib/api-zod` and `lib/api-client-react`; the final `typecheck:libs` step passes. Confirm `TaxSettings` now includes `baseCurrency`:

Run: `grep -n "baseCurrency" lib/api-client-react/src/generated/api.schemas.ts`
Expected: a line showing `baseCurrency` inside the `TaxSettings` interface.

- [ ] **Step 3: Commit**

```bash
git add lib/api-spec/openapi.yaml lib/api-zod lib/api-client-react
git commit -m "feat(api): add baseCurrency to tax-settings schema; allow partial tax updates"
```

---

### Task 3: Update the tax-settings route for baseCurrency + partial updates

**Files:**
- Modify: `app/app/api/tax-settings/route.ts`

- [ ] **Step 1: Update DEFAULTS, `map`, and the PUT handler**

Replace the file body from the `DEFAULTS` line through the end with:

```ts
const DEFAULTS = { remittanceTaxPct: "15", salesTaxPct: "15", withholdingTaxPct: "7", baseCurrency: "PKR" };

const SUPPORTED_CURRENCIES = new Set(["USD", "EUR", "GBP", "INR", "JPY", "CAD", "AUD", "PKR", "SAR", "AED"]);

async function getOrCreate() {
  const [row] = await db.select().from(taxSettingsTable).limit(1);
  if (row) return row;
  const [created] = await db.insert(taxSettingsTable).values(DEFAULTS).returning();
  return created;
}

function map(r: typeof taxSettingsTable.$inferSelect) {
  return {
    id: r.id,
    remittanceTaxPct: Number(r.remittanceTaxPct),
    salesTaxPct: Number(r.salesTaxPct),
    withholdingTaxPct: Number(r.withholdingTaxPct),
    baseCurrency: r.baseCurrency,
  };
}

// Read is broad: tax rates feed billing math surfaces; edited only from Settings › General.
export async function GET(): Promise<Response> {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  return NextResponse.json(map(await getOrCreate()));
}

export async function PUT(req: Request): Promise<Response> {
  const auth = await requirePermission("settings.general:view");
  if (isAuthError(auth)) return auth;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = UpdateTaxSettingsBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const current = await getOrCreate();

  // Merge provided fields over current (partial update).
  const remittanceTaxPct = parsed.data.remittanceTaxPct ?? Number(current.remittanceTaxPct);
  const salesTaxPct = parsed.data.salesTaxPct ?? Number(current.salesTaxPct);
  const withholdingTaxPct = parsed.data.withholdingTaxPct ?? Number(current.withholdingTaxPct);
  const baseCurrency = parsed.data.baseCurrency ?? current.baseCurrency;

  // Range validation — remittance is a gross-up divisor (1 - rate/100) so must stay < 100;
  // sales/withholding are percentages in [0, 100].
  const pctOk = (n: number, maxExclusive: boolean) => n >= 0 && (maxExclusive ? n < 100 : n <= 100);
  if (!pctOk(remittanceTaxPct, true) || !pctOk(salesTaxPct, false) || !pctOk(withholdingTaxPct, false)) {
    return NextResponse.json(
      { error: "Tax percentages must be in range (remittance 0–99.99, sales/withholding 0–100)" },
      { status: 400 },
    );
  }
  if (!SUPPORTED_CURRENCIES.has(baseCurrency)) {
    return NextResponse.json({ error: `Unsupported base currency: ${baseCurrency}` }, { status: 400 });
  }

  const [row] = await db.update(taxSettingsTable).set({
    remittanceTaxPct: String(remittanceTaxPct),
    salesTaxPct: String(salesTaxPct),
    withholdingTaxPct: String(withholdingTaxPct),
    baseCurrency,
  }).where(eq(taxSettingsTable.id, current.id)).returning();
  return NextResponse.json(map(row));
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @workspace/web typecheck`
Expected: PASS (no errors). `UpdateTaxSettingsBody` now has optional fields, so `parsed.data.baseCurrency` etc. are typed as `number | undefined` / `string | undefined`.

- [ ] **Step 3: Commit**

```bash
git add app/app/api/tax-settings/route.ts
git commit -m "feat(api): tax-settings route reads/writes baseCurrency with partial updates"
```

---

### Task 4: Default `formatMoney` to PKR (TDD)

This is the single highest-leverage fix: every chart whose `currency` prop is never passed, and every `formatMoney(x)` no-arg call, currently defaults to `"USD"` → `$`. Defaulting to PKR makes them render `PKR` instead.

**Files:**
- Modify: `app/lib/analytics/currency.ts:18`
- Test: `app/lib/analytics/currency.test.ts`

- [ ] **Step 1: Add failing tests for the PKR default**

Append these cases inside the `describe("currency", ...)` block in `app/lib/analytics/currency.test.ts`:

```ts
  it("defaults to PKR (never $) when no currency is given", () => {
    expect(formatMoney(1500)).toBe("PKR 1.5K");
    expect(formatMoney(-2_000_000)).toBe("-PKR 2.0M");
    expect(formatMoney(500)).toBe("PKR 500");
  });
  it("still renders $ when USD is explicitly requested", () => {
    expect(formatMoney(1500, "USD")).toBe("$1.5K");
  });
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `cd app && pnpm exec vitest run lib/analytics/currency.test.ts`
Expected: FAIL — `formatMoney(1500)` returns `"$1.5K"` (current USD default), not `"PKR 1.5K"`.

- [ ] **Step 3: Change the default currency to PKR**

In `app/lib/analytics/currency.ts`, change the signature on line 18:

```ts
export function formatMoney(n: number, currency = "PKR"): string {
```

(The existing prefix logic already produces `"PKR "` for non-USD/EUR/GBP currencies, so `formatMoney(1500)` → `"PKR 1.5K"`.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd app && pnpm exec vitest run lib/analytics/currency.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add app/lib/analytics/currency.ts app/lib/analytics/currency.test.ts
git commit -m "fix(currency): default formatMoney to PKR so PKR amounts never render \$"
```

---

### Task 5: Add a `useBaseCurrency()` hook

**Files:**
- Create: `app/lib/dashboard/use-base-currency.ts`

- [ ] **Step 1: Create the hook**

Create `app/lib/dashboard/use-base-currency.ts`:

```ts
"use client";

import { useGetTaxSettings } from "@workspace/api-client-react";

/**
 * Single source of truth for the app's base display currency.
 * Backed by the DB (tax_settings.baseCurrency); defaults to PKR until loaded.
 * Rates + partner amounts stay USD regardless — this only governs analytics/dashboard aggregates.
 */
export function useBaseCurrency(): string {
  const { data } = useGetTaxSettings();
  return data?.baseCurrency ?? "PKR";
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @workspace/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/lib/dashboard/use-base-currency.ts
git commit -m "feat(currency): add useBaseCurrency hook sourced from DB tax-settings"
```

---

### Task 6: Make `use-adjusted-summary` read the real base currency

Currently it hardcodes `baseCurrency: "PKR"`, so KPI cards always say PKR even if the base is changed. Wire it to the DB value.

**Files:**
- Modify: `app/lib/dashboard/use-adjusted-summary.ts`

- [ ] **Step 1: Read the base currency from the hook**

Replace the file contents with:

```ts
"use client";

import { useGetDashboardSummary } from "@workspace/api-client-react";
import { useDashboardRange } from "@/lib/dashboard/range-context";
import { useBaseCurrency } from "@/lib/dashboard/use-base-currency";

/**
 * The dashboard summary endpoint sources from `billing_records` and returns
 * totalRevenue/totalCost/totalProfit/marginPct already computed in PKR (via
 * `computeRow`). We surface the configured base currency for display; when it is
 * PKR (the default) no conversion is needed.
 */
export function useAdjustedSummary() {
  const range = useDashboardRange();
  const baseCurrency = useBaseCurrency();
  const { data: summary, isLoading } = useGetDashboardSummary(range as never);

  return { summary, adjustedSummary: summary ?? null, isLoading, baseCurrency };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @workspace/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/lib/dashboard/use-adjusted-summary.ts
git commit -m "feat(currency): use-adjusted-summary reads base currency from settings"
```

---

### Task 7: Persist the base-currency selector to the DB

The Settings › General base-currency selector currently writes only to `localStorage` and defaults to `"USD"`. Make it default PKR, seed from the DB, and persist changes to the DB.

**Files:**
- Modify: `app/app/(dashboard)/settings/page.tsx:103-105` (default), `:175-185` (`handleBaseCurrencyChange`), and add hook usage near the other catalog hooks (~`:137-144`).

- [ ] **Step 1: Default the base-currency state to PKR**

Change the initializer (line ~103–105) so the fallback is PKR, not USD:

```ts
  const [baseCurrency, setBaseCurrency] = useState<string>(
    () => (typeof window !== "undefined" ? localStorage.getItem("adops-base-currency") : null) || "PKR"
  );
```

- [ ] **Step 2: Instantiate the tax-settings hooks in the main page component**

In `SettingsPage`, next to the other catalog hooks (after the `deletePaymentTermM` line, ~line 144), add:

```ts
  const { data: taxSettingsForCurrency } = useGetTaxSettings();
  const updateBaseCurrency = useUpdateTaxSettings({
    mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getGetTaxSettingsQueryKey() }) },
  });
```

`useGetTaxSettings`, `useUpdateTaxSettings`, and `getGetTaxSettingsQueryKey` are already imported (line 15).

- [ ] **Step 3: Seed the selector from the DB once it loads**

Add this effect near the other `useEffect`s (e.g. after the effect at line ~168–173):

```ts
  useEffect(() => {
    if (taxSettingsForCurrency?.baseCurrency) {
      setBaseCurrency(taxSettingsForCurrency.baseCurrency);
      if (typeof window !== "undefined") {
        localStorage.setItem("adops-base-currency", taxSettingsForCurrency.baseCurrency);
      }
    }
  }, [taxSettingsForCurrency?.baseCurrency]);
```

- [ ] **Step 4: Persist on change**

Update `handleBaseCurrencyChange` (line ~175) to also PUT to the DB:

```ts
  const handleBaseCurrencyChange = (val: string) => {
    setBaseCurrency(val);
    localStorage.setItem("adops-base-currency", val);
    updateBaseCurrency.mutate({ data: { baseCurrency: val } });
    if (rateMode === "Automatic") {
      fetchRates(val);
    } else {
      const updated = { ...exchangeRates, [val.toLowerCase()]: 1.0 };
      setExchangeRates(updated);
      localStorage.setItem("adops-exchange-rates", JSON.stringify(updated));
    }
  };
```

(The partial-update PUT from Task 3 means sending `{ baseCurrency }` alone is valid and won't disturb the tax fields.)

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @workspace/web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/app/(dashboard)/settings/page.tsx
git commit -m "feat(settings): persist base currency to DB, default PKR"
```

---

### Task 8: Targeted USD-default cleanups

Fix the remaining spots that still hardcode USD/`$`: CashFlowChart's localStorage default, the alert PPO line (which is genuinely USD and must stay so), and the KPI `$0` loading fallbacks.

**Files:**
- Modify: `app/components/analytics/charts/CashFlowChart.tsx:25-40,58,62`
- Modify: `app/app/api/analytics/alerts/route.ts:109`
- Modify: `app/components/dashboard/widgets/KpiRevenue.tsx:20`, `KpiProfit.tsx:20`, `KpiCost.tsx:16`

- [ ] **Step 1: CashFlowChart — read the DB base currency, default PKR**

In `app/components/analytics/charts/CashFlowChart.tsx`:

Add the hook import after the currency import (line ~16):

```ts
import { useBaseCurrency } from "@/lib/dashboard/use-base-currency";
```

Replace the component's opening + base-currency read (lines 25–32) with:

```ts
export function CashFlowChart({ buckets }: { buckets: CashFlowBucket[] }) {
  const baseCurrency = useBaseCurrency();
  const rawRates = typeof window !== "undefined" ? localStorage.getItem("adops-exchange-rates") : null;
  const exchangeRates = rawRates ? JSON.parse(rawRates) : DEFAULT_RATES;

  if (!buckets || buckets.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">No data for selected period</p>;
  }
```

(The hook must be called unconditionally before the early return — hence the reorder. The `tickFormatter`/`formatter` on lines 58/62 already use `baseCurrency`, now sourced from the DB and defaulting to PKR.)

- [ ] **Step 2: Alerts route — PPO overspend is USD, keep it explicit**

In `app/app/api/analytics/alerts/route.ts`, the PPO overspend message (line ~109) shows partner-side amounts (partner budgets/bills are USD). With `formatMoney` now defaulting to PKR, make the USD explicit so it doesn't mislabel:

```ts
        message: `PPO ${ppo.code} overspent: ${formatMoney(consumed, "USD")} of ${formatMoney(budget, "USD")}`,
```

Leave the overdue-invoice line (`formatMoney(outstanding)`, line ~92) as-is — that's a client receivable in PKR, and the new PKR default is correct there.

- [ ] **Step 3: KPI `$0` fallbacks → PKR-consistent**

In `KpiRevenue.tsx` (line 20), `KpiProfit.tsx` (line 20), and `KpiCost.tsx` (line 16), replace the `: "$0"` fallback with a base-currency-aware zero. For each, change:

```tsx
        value={adjustedSummary ? formatMoney(adjustedSummary.totalRevenue, baseCurrency) : "$0"}
```

to:

```tsx
        value={adjustedSummary ? formatMoney(adjustedSummary.totalRevenue, baseCurrency) : formatMoney(0, baseCurrency)}
```

(Use the matching field per file: `totalRevenue` in KpiRevenue, `totalProfit` in KpiProfit, `totalCost` in KpiCost. `baseCurrency` is already destructured from `useAdjustedSummary()` in each.)

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @workspace/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/components/analytics/charts/CashFlowChart.tsx app/app/api/analytics/alerts/route.ts app/components/dashboard/widgets/KpiRevenue.tsx app/components/dashboard/widgets/KpiProfit.tsx app/components/dashboard/widgets/KpiCost.tsx
git commit -m "fix(currency): remove USD defaults in cashflow chart, PPO alert, KPI fallbacks"
```

---

### Task 9: Full verification

- [ ] **Step 1: Run the full app test suite**

Run: `pnpm --filter @workspace/web test`
Expected: PASS (existing suite green; new currency cases included).

- [ ] **Step 2: Typecheck the whole workspace**

Run: `pnpm typecheck`
Expected: PASS (libs + app).

- [ ] **Step 3: Manual verification (dev server)**

Run: `pnpm --filter @workspace/web dev`, then in the browser:
- Dashboard KPI cards (Revenue/Cost/Profit/Cash Position) show `PKR …`, no `$`.
- Analytics charts (Profitability, Pareto, Waterfall, Forecast, Aging, Cash Flow, etc.) show `PKR` on axes/tooltips, no `$` on PKR amounts.
- Partner bills/payments still show `$`/USD (unchanged — correct).
- Settings › General → change Base Currency, reload the page: the selection persists (came from the DB, not just this browser).

Record the result (pass/fail per bullet). If any PKR surface still shows `$`, grep for a `formatMoney(` call missing its currency arg on that surface and pass the correct currency.

- [ ] **Step 4: Final commit (if manual fixes were needed)**

```bash
git add -A
git commit -m "fix(currency): resolve remaining \$-on-PKR surfaces found in QA"
```

---

## Self-Review

**Spec coverage (Phase 1 section of the design doc):**
- DB-persisted base currency, default PKR → Tasks 1–3, 7. ✓
- `formatMoney` never emits `$` on a PKR amount → Task 4 (default PKR) + Task 8. ✓
- `useBaseCurrency()` single source; fix `use-adjusted-summary` + charts → Tasks 5, 6, 8. ✓
- USD stays USD for rates + partner amounts → Task 8 keeps PPO/partner USD; partner bill/payment components untouched. ✓
- Per-record forex preserved, global rate never re-derives stored amounts → no compute path touched; only display defaults changed. ✓
- Explicitly out of scope: threading an arbitrary non-PKR base through every chart's `currency` prop (documented in Architecture). Acceptable — PKR default eliminates the visible bug.

**Placeholder scan:** No TBD/TODO; every code step shows full code; every command has expected output. ✓

**Type consistency:** `baseCurrency` is `string` end-to-end (schema `text` → openapi `string` → generated `TaxSettings.baseCurrency` → `useBaseCurrency(): string`). `useBaseCurrency()` name is identical in Tasks 5, 6, 8. `formatMoney(n, currency="PKR")` signature matches all call sites. ✓

**Notes / risks:**
- `pnpm --filter @workspace/db push` requires a live DB connection; `.env` must be configured.
- After Task 2 codegen, if orval reorders unrelated generated lines, include them in the Task 2 commit (generated output is committed in this repo).
- The `useBaseCurrency()` hook reorder in CashFlowChart (Task 8) is required because hooks must run before the early `return` — verified against the current file.
