# Dashboard Cockpit Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the home Dashboard (`app/app/(dashboard)/page.tsx`) as a registry-driven, role-gated widget cockpit that reuses the existing analytics component library, shows real KPI deltas over a selectable date range, and persists each user's layout in the database.

**Architecture:** Keep the `react-grid-layout` drag/drop grid but drive it from a typed **widget registry** (`id → { permission, defaultLayout, Component }`) rendered inside a shared `<DashboardWidget>` shell with a per-widget error boundary. Widgets are filtered by the user's permissions. Layout + active-widget state moves from `localStorage` to a `dashboard_layouts` DB table via a session-scoped `GET/PUT /api/me/dashboard-layout` endpoint (with a one-time localStorage migration). All new widgets are thin wrappers over `app/components/analytics/*` chart components fed by hooks that already exist in `@workspace/api-client-react`.

**Tech Stack:** Next.js 15 (App Router, RSC + client), React 19, `react-grid-layout@2`, `recharts@3`, Drizzle ORM (`drizzle-kit push`), `@tanstack/react-query`, `zod`, Vitest (node — no jsdom/testing-library in repo).

---

## Conventions (read once)

- **Package/dir:** app is `@workspace/web` at `app/`. DB is `@workspace/db` at `lib/db/`.
- **Run tests:** `pnpm --filter @workspace/web exec vitest run <path> -t "<name>"`
- **Typecheck:** `pnpm --filter @workspace/web typecheck`
- **Apply schema to DB:** `pnpm --filter @workspace/db push` (this repo uses `drizzle-kit push`, not a migrate journal; the numbered `.sql` files under `lib/db/migrations/` are kept for record only).
- **Session user id:** `requireAuth()` (`app/lib/auth/require.ts`) returns `{ user }` where `user.sub` is the numeric user id.
- **Testing scope:** The repo has **no** `@testing-library/react`/jsdom. TDD applies to **pure functions** and **API routes** (node env). Visual widget wrappers are verified by `typecheck` + a manual dogfood step — do **not** add render tests or a jsdom setup.
- **Commits:** conventional commits, e.g. `feat(dashboard): …`, `test(dashboard): …`. Commit at the end of each task.
- **Money/format helpers:** `formatMoney`, `convertTo`, `DEFAULT_RATES` from `@/lib/analytics/currency` (already used by the current page — preserve currency behavior).

## File structure (created / modified)

**Created**
- `lib/db/src/schema/dashboard-layouts.ts` — `dashboard_layouts` table + row type.
- `lib/db/migrations/0006_dashboard_layouts.sql` — SQL of record.
- `app/app/api/me/dashboard-layout/route.ts` — session-scoped GET/PUT.
- `app/app/api/me/dashboard-layout/route.test.ts` — route tests.
- `app/lib/dashboard/types.ts` — `WidgetId`, `WidgetDef`, `DashboardLayoutItem`, `SavedDashboard`.
- `app/lib/dashboard/resolve-layout.ts` + `.test.ts` — pure init/merge/migration logic.
- `app/lib/dashboard/role-gating.ts` + `.test.ts` — pure permission filter.
- `app/lib/dashboard/presets.ts` + `.test.ts` — Exec/Ops/Finance presets + resolver.
- `app/lib/dashboard/use-dashboard-layout.ts` — React Query persistence hook.
- `app/components/dashboard/DashboardWidget.tsx` — shared widget shell.
- `app/components/dashboard/widget-registry.tsx` — registry (all widgets).
- `app/components/dashboard/widgets/*.tsx` — one file per widget wrapper.
- `app/components/dashboard/DashboardDateRange.tsx` — compact date-range control.

**Modified**
- `app/app/(dashboard)/page.tsx` — rebuilt around registry + persistence + palette.
- `app/app/api/analytics/dashboard/route.ts` — real prior-period deltas.
- `app/lib/analytics/date-range.ts` (new) + `.test.ts` — prior-range math (or extend existing helper if present).
- `app/lib/auth/user-context.tsx` — add `usePermissionSet()`.
- `lib/db/src/schema/index.ts` — export the new table.

---

# Phase 1 — Framework & persistence

Goal: same widgets as today, but rendered from a registry inside a shared shell, role-gated, and persisted per-account. No visible feature loss.

### Task 1: `dashboard_layouts` table

**Files:**
- Create: `lib/db/src/schema/dashboard-layouts.ts`
- Modify: `lib/db/src/schema/index.ts`
- Create: `lib/db/migrations/0006_dashboard_layouts.sql`

- [ ] **Step 1: Write the schema**

`lib/db/src/schema/dashboard-layouts.ts`:
```ts
import { pgTable, serial, integer, jsonb, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export type DashboardLayoutItem = {
  i: string; x: number; y: number; w: number; h: number; minW?: number; minH?: number;
};

// One row per user. Holds the user's dashboard grid + active widget set.
export const dashboardLayoutsTable = pgTable("dashboard_layouts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id).unique(),
  activeWidgets: jsonb("active_widgets").$type<string[]>().notNull(),
  layout: jsonb("layout").$type<DashboardLayoutItem[]>().notNull(),
  preset: text("preset"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type DashboardLayoutRow = typeof dashboardLayoutsTable.$inferSelect;
```

- [ ] **Step 2: Export it**

Append to `lib/db/src/schema/index.ts`:
```ts
export * from "./dashboard-layouts";
```

- [ ] **Step 3: Write the SQL of record**

`lib/db/migrations/0006_dashboard_layouts.sql`:
```sql
CREATE TABLE IF NOT EXISTS "dashboard_layouts" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "active_widgets" jsonb NOT NULL,
  "layout" jsonb NOT NULL,
  "preset" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "dashboard_layouts_user_id_unique" UNIQUE("user_id")
);
ALTER TABLE "dashboard_layouts"
  ADD CONSTRAINT "dashboard_layouts_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
```

- [ ] **Step 4: Apply to the database**

Run: `pnpm --filter @workspace/db push`
Expected: drizzle-kit reports creating `dashboard_layouts`; no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/db/src/schema/dashboard-layouts.ts lib/db/src/schema/index.ts lib/db/migrations/0006_dashboard_layouts.sql
git commit -m "feat(db): add dashboard_layouts table for per-account dashboard state"
```

---

### Task 2: `GET/PUT /api/me/dashboard-layout`

**Files:**
- Create: `app/app/api/me/dashboard-layout/route.ts`
- Test: `app/app/api/me/dashboard-layout/route.test.ts`

- [ ] **Step 1: Write the failing route test**

`app/app/api/me/dashboard-layout/route.test.ts` (mirror the mocking style of `app/app/api/analytics/dashboard/route.test.ts`; adapt mock paths to that file's actual pattern):
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const requireAuth = vi.fn();
vi.mock("@/lib/auth/require", () => ({
  requireAuth: () => requireAuth(),
  isAuthError: (r: unknown) => r instanceof Response,
}));

const rows: Record<number, unknown> = {};
vi.mock("@workspace/db", () => ({
  db: {},
  dashboardLayoutsTable: {},
}));
// The route uses a thin data module so it is trivially mockable:
vi.mock("@/lib/dashboard/layout-store", () => ({
  getLayout: (userId: number) => Promise.resolve(rows[userId] ?? null),
  upsertLayout: (userId: number, body: unknown) => { rows[userId] = body; return Promise.resolve({ userId, ...(body as object) }); },
}));

import { GET, PUT } from "./route";

beforeEach(() => { for (const k of Object.keys(rows)) delete rows[Number(k)]; requireAuth.mockReset(); });

describe("me/dashboard-layout", () => {
  it("GET returns null when the user has no saved row", async () => {
    requireAuth.mockResolvedValue({ user: { sub: 7 } });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it("PUT upserts for the session user and GET reads it back", async () => {
    requireAuth.mockResolvedValue({ user: { sub: 7 } });
    const body = { activeWidgets: ["revenue-kpi"], layout: [{ i: "revenue-kpi", x: 0, y: 0, w: 3, h: 3 }], preset: "exec" };
    const putRes = await PUT(new Request("http://x", { method: "PUT", body: JSON.stringify(body) }));
    expect(putRes.status).toBe(200);
    const getRes = await GET();
    expect(await getRes.json()).toMatchObject({ activeWidgets: ["revenue-kpi"], preset: "exec" });
  });

  it("GET returns 401 when unauthenticated", async () => {
    requireAuth.mockResolvedValue(new Response(null, { status: 401 }));
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("PUT rejects a malformed body with 400", async () => {
    requireAuth.mockResolvedValue({ user: { sub: 7 } });
    const res = await PUT(new Request("http://x", { method: "PUT", body: JSON.stringify({ activeWidgets: "nope" }) }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @workspace/web exec vitest run app/app/api/me/dashboard-layout/route.test.ts`
Expected: FAIL — `./route` has no `GET`/`PUT` export.

- [ ] **Step 3: Write the data store module**

`app/lib/dashboard/layout-store.ts`:
```ts
import { eq } from "drizzle-orm";
import { db, dashboardLayoutsTable } from "@workspace/db";
import type { DashboardLayoutItem } from "@workspace/db";

export interface LayoutBody {
  activeWidgets: string[];
  layout: DashboardLayoutItem[];
  preset: string | null;
}

export async function getLayout(userId: number) {
  const [row] = await db.select().from(dashboardLayoutsTable).where(eq(dashboardLayoutsTable.userId, userId));
  return row ?? null;
}

export async function upsertLayout(userId: number, body: LayoutBody) {
  const [row] = await db
    .insert(dashboardLayoutsTable)
    .values({ userId, activeWidgets: body.activeWidgets, layout: body.layout, preset: body.preset })
    .onConflictDoUpdate({
      target: dashboardLayoutsTable.userId,
      set: { activeWidgets: body.activeWidgets, layout: body.layout, preset: body.preset },
    })
    .returning();
  return row;
}
```

- [ ] **Step 4: Write the route**

`app/app/api/me/dashboard-layout/route.ts`:
```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, isAuthError } from "@/lib/auth/require";
import { getLayout, upsertLayout } from "@/lib/dashboard/layout-store";

export const runtime = "nodejs";

const LayoutItem = z.object({
  i: z.string(), x: z.number(), y: z.number(), w: z.number(), h: z.number(),
  minW: z.number().optional(), minH: z.number().optional(),
});
const LayoutBodySchema = z.object({
  activeWidgets: z.array(z.string()),
  layout: z.array(LayoutItem),
  preset: z.string().nullable().default(null),
});

export async function GET(): Promise<Response> {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const row = await getLayout(auth.user.sub);
  return NextResponse.json(row);
}

export async function PUT(req: Request): Promise<Response> {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  const parsed = LayoutBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const row = await upsertLayout(auth.user.sub, parsed.data);
  return NextResponse.json(row);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @workspace/web exec vitest run app/app/api/me/dashboard-layout/route.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add app/app/api/me/dashboard-layout app/lib/dashboard/layout-store.ts
git commit -m "feat(dashboard): session-scoped GET/PUT layout endpoint"
```

---

### Task 3: Shared types + layout resolution (pure)

**Files:**
- Create: `app/lib/dashboard/types.ts`
- Create: `app/lib/dashboard/resolve-layout.ts`
- Test: `app/lib/dashboard/resolve-layout.test.ts`

- [ ] **Step 1: Write the types**

`app/lib/dashboard/types.ts`:
```ts
import type { DashboardLayoutItem } from "@workspace/db";
export type { DashboardLayoutItem };

export type WidgetCategory = "kpi" | "profitability" | "financial-ops" | "relationships" | "risk" | "activity";

export interface WidgetDef {
  id: string;
  label: string;
  description: string;
  category: WidgetCategory;
  permission: string | null; // null => only page-level "View Dashboard"
  defaultLayout: { w: number; h: number; minW: number; minH: number };
  Component: React.ComponentType;
}

export interface SavedDashboard {
  activeWidgets: string[];
  layout: DashboardLayoutItem[];
  preset: string | null;
}
```

- [ ] **Step 2: Write the failing test**

`app/lib/dashboard/resolve-layout.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { resolveInitialDashboard, readLocalDashboard, LOCAL_KEYS } from "./resolve-layout";

const fallback = { activeWidgets: ["revenue-kpi"], layout: [{ i: "revenue-kpi", x: 0, y: 0, w: 3, h: 3 }], preset: "exec" };

describe("resolveInitialDashboard", () => {
  it("uses the server row when present", () => {
    const server = { activeWidgets: ["profit-kpi"], layout: [], preset: null };
    expect(resolveInitialDashboard(server, null, fallback)).toEqual({ value: server, migrateFromLocal: false });
  });
  it("migrates from local when server is null and local exists", () => {
    const local = { activeWidgets: ["cost-kpi"], layout: [{ i: "cost-kpi", x: 0, y: 0, w: 3, h: 3 }], preset: null };
    expect(resolveInitialDashboard(null, local, fallback)).toEqual({ value: local, migrateFromLocal: true });
  });
  it("falls back to the default preset when both are empty", () => {
    expect(resolveInitialDashboard(null, null, fallback)).toEqual({ value: fallback, migrateFromLocal: false });
  });
});

describe("readLocalDashboard", () => {
  it("returns null when no legacy keys are set", () => {
    const store = new Map<string, string>();
    const shim = { getItem: (k: string) => store.get(k) ?? null } as unknown as Storage;
    expect(readLocalDashboard(shim)).toBeNull();
  });
  it("reads legacy localStorage keys", () => {
    const store = new Map<string, string>([
      [LOCAL_KEYS.widgets, JSON.stringify(["revenue"])],
      [LOCAL_KEYS.layout, JSON.stringify([{ i: "revenue-kpi", x: 0, y: 0, w: 3, h: 3 }])],
    ]);
    const shim = { getItem: (k: string) => store.get(k) ?? null } as unknown as Storage;
    expect(readLocalDashboard(shim)).toMatchObject({ activeWidgets: ["revenue"] });
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @workspace/web exec vitest run app/lib/dashboard/resolve-layout.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

`app/lib/dashboard/resolve-layout.ts`:
```ts
import type { SavedDashboard } from "./types";

export const LOCAL_KEYS = {
  widgets: "adops-dashboard-active-widgets",
  layout: "adops-dashboard-layout",
} as const;

export function readLocalDashboard(storage: Storage): SavedDashboard | null {
  const widgets = storage.getItem(LOCAL_KEYS.widgets);
  const layout = storage.getItem(LOCAL_KEYS.layout);
  if (!widgets && !layout) return null;
  try {
    return {
      activeWidgets: widgets ? JSON.parse(widgets) : [],
      layout: layout ? JSON.parse(layout) : [],
      preset: null,
    };
  } catch {
    return null;
  }
}

export function resolveInitialDashboard(
  server: SavedDashboard | null,
  local: SavedDashboard | null,
  fallback: SavedDashboard,
): { value: SavedDashboard; migrateFromLocal: boolean } {
  if (server) return { value: server, migrateFromLocal: false };
  if (local) return { value: local, migrateFromLocal: true };
  return { value: fallback, migrateFromLocal: false };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @workspace/web exec vitest run app/lib/dashboard/resolve-layout.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add app/lib/dashboard/types.ts app/lib/dashboard/resolve-layout.ts app/lib/dashboard/resolve-layout.test.ts
git commit -m "feat(dashboard): shared widget types + pure layout resolution/migration"
```

---

### Task 4: Role-gating (pure) + `usePermissionSet`

**Files:**
- Create: `app/lib/dashboard/role-gating.ts`
- Test: `app/lib/dashboard/role-gating.test.ts`
- Modify: `app/lib/auth/user-context.tsx`

- [ ] **Step 1: Write the failing test**

`app/lib/dashboard/role-gating.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { visibleWidgetIds } from "./role-gating";
import type { WidgetDef } from "./types";

const def = (id: string, permission: string | null): WidgetDef => ({
  id, label: id, description: "", category: "kpi", permission,
  defaultLayout: { w: 3, h: 3, minW: 2, minH: 2 }, Component: () => null,
});
const registry = {
  "revenue-kpi": def("revenue-kpi", null),
  "cost-kpi": def("cost-kpi", "View Cost"),
  "aging": def("aging", "View Payments"),
};

describe("visibleWidgetIds", () => {
  it("keeps null-permission widgets and drops ones the user lacks", () => {
    const has = (p: string) => p === "View Cost";
    expect(visibleWidgetIds(["revenue-kpi", "cost-kpi", "aging"], registry, has))
      .toEqual(["revenue-kpi", "cost-kpi"]);
  });
  it("drops ids not present in the registry", () => {
    expect(visibleWidgetIds(["revenue-kpi", "ghost"], registry, () => true)).toEqual(["revenue-kpi"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @workspace/web exec vitest run app/lib/dashboard/role-gating.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure filter**

`app/lib/dashboard/role-gating.ts`:
```ts
import type { WidgetDef } from "./types";

export function visibleWidgetIds(
  ids: string[],
  registry: Record<string, WidgetDef>,
  has: (permission: string) => boolean,
): string[] {
  return ids.filter((id) => {
    const def = registry[id];
    if (!def) return false;
    return def.permission === null || has(def.permission);
  });
}
```

- [ ] **Step 4: Add `usePermissionSet` to user-context**

Append to `app/lib/auth/user-context.tsx` (reuses the existing `roles` query pattern in that file):
```ts
export function usePermissionSet(): { has: (permission: string) => boolean; isLoading: boolean } {
  const { user, isLoading } = useContext(UserContext);
  const { data: roles } = useQuery<Role[]>({
    queryKey: ["roles"],
    queryFn: () => fetch("/api/roles").then((r) => r.json()),
    staleTime: Infinity,
    enabled: !!user && user.role !== "System Admin" && !user.isSystem,
  });

  const isAdmin = !!user && (user.role === "System Admin" || user.isSystem);
  const granted = new Set<string>(
    isAdmin ? [] : (roles?.find((r) => r.name.toLowerCase() === user?.role.toLowerCase())?.permissions ?? []),
  );
  return {
    has: (permission: string) => isAdmin || granted.has(permission),
    isLoading: isLoading || (!!user && !isAdmin && !roles),
  };
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @workspace/web exec vitest run app/lib/dashboard/role-gating.test.ts`
Expected: PASS (2 tests).
Run: `pnpm --filter @workspace/web typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/lib/dashboard/role-gating.ts app/lib/dashboard/role-gating.test.ts app/lib/auth/user-context.tsx
git commit -m "feat(dashboard): permission-based widget gating + usePermissionSet"
```

---

### Task 5: `<DashboardWidget>` shell

**Files:**
- Create: `app/components/dashboard/DashboardWidget.tsx`

- [ ] **Step 1: Implement the shell**

Reuses `app/components/analytics/WidgetErrorBoundary.tsx` and matches the current card chrome/drag-handle so grid dragging keeps working (`draggableHandle=".widget-drag-handle"`).

`app/components/dashboard/DashboardWidget.tsx`:
```tsx
"use client";

import { GripHorizontal } from "lucide-react";
import { WidgetErrorBoundary } from "@/components/analytics/WidgetErrorBoundary";
import { Skeleton } from "@/components/ui/skeleton";

export interface DashboardWidgetProps {
  title?: string;
  loading?: boolean;
  isEmpty?: boolean;
  emptyLabel?: string;
  /** When false, the body area does not stretch (KPI tiles). Charts pass true. */
  fill?: boolean;
  children: React.ReactNode;
}

export function DashboardWidget({
  title, loading, isEmpty, emptyLabel = "No data yet", fill = true, children,
}: DashboardWidgetProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex shrink-0 cursor-grab items-center justify-center border-b border-border bg-muted/10 p-1 active:cursor-grabbing widget-drag-handle">
        <GripHorizontal className="h-3 w-3 text-muted-foreground/50" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-4">
        {title && <h3 className="mb-3 shrink-0 text-sm font-semibold text-foreground">{title}</h3>}
        <div className={fill ? "min-h-0 flex-1" : ""}>
          <WidgetErrorBoundary title={title ?? "Widget"}>
            {loading ? (
              <Skeleton className="h-full min-h-[80px] w-full" />
            ) : isEmpty ? (
              <div className="flex h-full min-h-[80px] items-center justify-center text-sm text-muted-foreground">
                {emptyLabel}
              </div>
            ) : (
              children
            )}
          </WidgetErrorBoundary>
        </div>
      </div>
    </div>
  );
}
```

> If `WidgetErrorBoundary`'s prop name is not `title`, open `app/components/analytics/WidgetErrorBoundary.tsx` and match its actual prop signature before finishing this step.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @workspace/web typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/components/dashboard/DashboardWidget.tsx
git commit -m "feat(dashboard): shared widget shell with per-widget error boundary"
```

---

### Task 6: Port existing widgets into wrapper components

Each widget is a self-contained client component that calls its hook and renders inside `<DashboardWidget>`. Create one file per widget under `app/components/dashboard/widgets/`. These reproduce today's widgets (no new data).

**Files:** Create `app/components/dashboard/widgets/{KpiRevenue,KpiCost,KpiProfit,KpiMargin,Counts,ProfitTrend,Alerts,WorkingCapital,ClientPerformance,PlatformPerformance,RecentTransactions}.tsx`

- [ ] **Step 1: KPI tiles (reuse analytics `KpiCard`, delete the inline dashboard copy)**

`app/components/dashboard/widgets/KpiRevenue.tsx`:
```tsx
"use client";
import { DollarSign } from "lucide-react";
import { useGetDashboardSummary, useGetProfitOverTime } from "@workspace/api-client-react";
import { KpiCard } from "@/components/analytics/KpiCard";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";
import { formatMoney } from "@/lib/analytics/currency";

export function KpiRevenue() {
  const { data: summary, isLoading } = useGetDashboardSummary();
  const { data: series } = useGetProfitOverTime();
  return (
    <DashboardWidget fill={false}>
      <KpiCard
        title="Total Revenue"
        value={summary ? formatMoney(summary.totalRevenue) : "$0"}
        delta={summary?.revenueChange}
        positive={(summary?.revenueChange ?? 0) >= 0}
        sparkline={series?.map((p) => p.revenue)}
        icon={<DollarSign className="h-4 w-4" />}
        loading={isLoading}
      />
    </DashboardWidget>
  );
}
```

`KpiCost.tsx`, `KpiProfit.tsx`, `KpiMargin.tsx` follow the identical shape — only the differing lines below (everything else — imports of `KpiCard`/`DashboardWidget`/hook, the wrapper — is the same as `KpiRevenue`):

- **KpiCost** — icon `Target`; `title="Total Cost"`; `value={summary ? formatMoney(summary.totalCost) : "$0"}`; `delta={summary?.costChange}`; `positive={(summary?.costChange ?? 0) <= 0}`; no sparkline.
- **KpiProfit** — icon `TrendingUp`; `title="Total Profit"`; `value={summary ? formatMoney(summary.totalProfit) : "$0"}`; `delta={summary?.profitChange}`; `positive={(summary?.profitChange ?? 0) >= 0}`; `sparkline={series?.map((p) => p.profit)}`.
- **KpiMargin** — icon `BarChart2`; `title="Margin %"`; `value={summary ? \`${summary.marginPct.toFixed(1)}%\` : "0%"}`; no delta; no sparkline.

- [ ] **Step 2: Counts, ProfitTrend, Alerts, WorkingCapital, Client/Platform, RecentTransactions**

Port each remaining widget by lifting its exact JSX out of the current `app/app/(dashboard)/page.tsx` into its own component, replacing the hand-rolled outer card+drag-handle with `<DashboardWidget title=...>` and moving the loading/empty checks to the shell's `loading`/`isEmpty` props. Data hooks stay identical to today:
- `Counts.tsx` — `useGetDashboardSummary` (the 3-up Clients/Platforms/Campaigns row; `fill={false}`).
- `ProfitTrend.tsx` — `useGetProfitOverTime` (the revenue+profit `AreaChart`; `title="Profit & Revenue"`).
- `Alerts.tsx` — `useGetAlerts` (`title="Alerts"`, keep the severity styling + count badge).
- `WorkingCapital.tsx` — `useGetAging` + currency conversion (the AR/AP/Cash-position panel; `title="Working Capital"`).
- `ClientPerformance.tsx` — `useGetAnalyticsByClient` (the bar chart; `title="Client Performance"`).
- `PlatformPerformance.tsx` — `useGetAnalyticsByPartner` (`title="Platform Performance"`).
- `RecentTransactions.tsx` — `useListTransactions({ limit: 10 })` (the table; `title="Recent Transactions"`, keep the neg/low-margin row highlighting).

Keep each component's currency logic (`convertTo`, `DEFAULT_RATES`, base currency from `localStorage`) exactly as it is in the current page so numbers do not change.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @workspace/web typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/components/dashboard/widgets
git commit -m "feat(dashboard): port existing widgets into registry wrapper components"
```

---

### Task 7: Registry + persistence hook + page rebuild

**Files:**
- Create: `app/components/dashboard/widget-registry.tsx`
- Create: `app/lib/dashboard/use-dashboard-layout.ts`
- Modify: `app/app/(dashboard)/page.tsx`

- [ ] **Step 1: Registry (Phase-1 widgets only; later phases append entries)**

`app/components/dashboard/widget-registry.tsx`:
```tsx
import type { WidgetDef } from "@/lib/dashboard/types";
import { KpiRevenue } from "./widgets/KpiRevenue";
import { KpiCost } from "./widgets/KpiCost";
import { KpiProfit } from "./widgets/KpiProfit";
import { KpiMargin } from "./widgets/KpiMargin";
import { Counts } from "./widgets/Counts";
import { ProfitTrend } from "./widgets/ProfitTrend";
import { Alerts } from "./widgets/Alerts";
import { WorkingCapital } from "./widgets/WorkingCapital";
import { ClientPerformance } from "./widgets/ClientPerformance";
import { PlatformPerformance } from "./widgets/PlatformPerformance";
import { RecentTransactions } from "./widgets/RecentTransactions";

const KPI = { w: 3, h: 3, minW: 2, minH: 2 };

export const widgetRegistry: Record<string, WidgetDef> = {
  "revenue-kpi": { id: "revenue-kpi", label: "Revenue", description: "Total client spend", category: "kpi", permission: null, defaultLayout: KPI, Component: KpiRevenue },
  "cost-kpi": { id: "cost-kpi", label: "Cost", description: "Platform cost", category: "kpi", permission: "View Cost", defaultLayout: KPI, Component: KpiCost },
  "profit-kpi": { id: "profit-kpi", label: "Profit", description: "Net profit", category: "kpi", permission: "View Cost", defaultLayout: KPI, Component: KpiProfit },
  "margin-kpi": { id: "margin-kpi", label: "Margin %", description: "Profit / revenue", category: "kpi", permission: "View Cost", defaultLayout: KPI, Component: KpiMargin },
  "counts-row": { id: "counts-row", label: "Counts", description: "Clients / platforms / campaigns", category: "kpi", permission: null, defaultLayout: { w: 12, h: 3, minW: 6, minH: 2 }, Component: Counts },
  "profit-chart": { id: "profit-chart", label: "Profit & Revenue", description: "Trend over time", category: "profitability", permission: null, defaultLayout: { w: 8, h: 9, minW: 4, minH: 6 }, Component: ProfitTrend },
  "alerts-panel": { id: "alerts-panel", label: "Alerts", description: "Risk alerts", category: "risk", permission: null, defaultLayout: { w: 4, h: 9, minW: 3, minH: 4 }, Component: Alerts },
  "working-capital": { id: "working-capital", label: "Working Capital", description: "AR / AP / cash", category: "financial-ops", permission: "View Payments", defaultLayout: { w: 4, h: 8, minW: 3, minH: 5 }, Component: WorkingCapital },
  "client-performance-chart": { id: "client-performance-chart", label: "Client Performance", description: "By client", category: "profitability", permission: "View Clients", defaultLayout: { w: 6, h: 8, minW: 4, minH: 5 }, Component: ClientPerformance },
  "platform-performance-chart": { id: "platform-performance-chart", label: "Platform Performance", description: "By platform", category: "profitability", permission: "View Partners", defaultLayout: { w: 6, h: 8, minW: 4, minH: 5 }, Component: PlatformPerformance },
  "transactions-table": { id: "transactions-table", label: "Recent Transactions", description: "Latest transactions", category: "activity", permission: "View Transactions", defaultLayout: { w: 12, h: 8, minW: 6, minH: 5 }, Component: RecentTransactions },
};

export const widgetList = Object.values(widgetRegistry);
```

- [ ] **Step 2: Persistence hook**

`app/lib/dashboard/use-dashboard-layout.ts`:
```ts
"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { SavedDashboard, DashboardLayoutItem } from "./types";
import { readLocalDashboard, resolveInitialDashboard, LOCAL_KEYS } from "./resolve-layout";
import { EXEC_PRESET } from "./presets"; // added in Task 15; until then import a local const fallback

async function fetchSaved(): Promise<SavedDashboard | null> {
  const res = await fetch("/api/me/dashboard-layout");
  if (!res.ok) return null;
  const row = await res.json();
  return row ? { activeWidgets: row.activeWidgets, layout: row.layout, preset: row.preset } : null;
}

async function putSaved(body: SavedDashboard): Promise<void> {
  await fetch("/api/me/dashboard-layout", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function useDashboardLayout() {
  const { data: server, isLoading } = useQuery({ queryKey: ["dashboard-layout"], queryFn: fetchSaved, staleTime: Infinity });
  const [state, setState] = useState<SavedDashboard | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resolve once the server query settles.
  useEffect(() => {
    if (isLoading || state) return;
    const local = typeof window !== "undefined" ? readLocalDashboard(window.localStorage) : null;
    const { value, migrateFromLocal } = resolveInitialDashboard(server ?? null, local, EXEC_PRESET);
    setState(value);
    if (migrateFromLocal) {
      void putSaved(value);
      window.localStorage.removeItem(LOCAL_KEYS.widgets);
      window.localStorage.removeItem(LOCAL_KEYS.layout);
    }
  }, [isLoading, server, state]);

  const persist = (next: SavedDashboard) => {
    setState(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void putSaved(next), 600);
  };

  return {
    ready: !!state,
    activeWidgets: state?.activeWidgets ?? [],
    layout: state?.layout ?? [],
    preset: state?.preset ?? null,
    setLayout: (layout: DashboardLayoutItem[]) => state && persist({ ...state, layout }),
    setActiveWidgets: (activeWidgets: string[]) => state && persist({ ...state, activeWidgets }),
    applyPreset: (p: SavedDashboard) => persist(p),
  };
}
```

> Until Task 15 creates `presets.ts`, temporarily define `EXEC_PRESET` inline in `resolve-layout.ts` and import it here; Task 15 moves it to `presets.ts` and re-points this import.

- [ ] **Step 3: Rebuild the page**

Rewrite `app/app/(dashboard)/page.tsx` to render from the registry. Replace the entire body of `DashboardContent` with:
```tsx
"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { ResponsiveGridLayout, useContainerWidth, type ResponsiveGridLayoutProps } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { PermissionGuard } from "@/components/PermissionGuard";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { usePermissionSet } from "@/lib/auth/user-context";
import { useDashboardLayout } from "@/lib/dashboard/use-dashboard-layout";
import { visibleWidgetIds } from "@/lib/dashboard/role-gating";
import { widgetRegistry, widgetList } from "@/components/dashboard/widget-registry";
import type { DashboardLayoutItem } from "@/lib/dashboard/types";

const RGL = ResponsiveGridLayout as React.ComponentType<ResponsiveGridLayoutProps & { draggableHandle?: string }>;

function DashboardContent() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { width, containerRef } = useContainerWidth();
  const perms = usePermissionSet();
  const dash = useDashboardLayout();

  if (!dash.ready) return <div className="flex min-h-[60vh] items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" /></div>;

  const visible = visibleWidgetIds(dash.activeWidgets, widgetRegistry, perms.has);

  const toggleWidget = (id: string) => {
    const next = dash.activeWidgets.includes(id)
      ? dash.activeWidgets.filter((w) => w !== id)
      : [...dash.activeWidgets, id];
    dash.setActiveWidgets(next);
  };

  const layoutFor = (ids: string[]): DashboardLayoutItem[] =>
    ids.map((id) => {
      const saved = dash.layout.find((l) => l.i === id);
      if (saved) return saved;
      const d = widgetRegistry[id].defaultLayout;
      return { i: id, x: 0, y: Infinity, w: d.w, h: d.h, minW: d.minW, minH: d.minH };
    });

  return (
    <div className="space-y-6 pb-12" ref={containerRef}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground">AdOps Intelligence Overview</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setPaletteOpen(true)} className="gap-1.5 text-xs" data-testid="add-widget-btn">
          <Plus className="h-3.5 w-3.5" /> Add Widget
        </Button>
      </div>

      <RGL
        className="layout"
        width={width}
        layouts={{ lg: layoutFor(visible) }}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
        rowHeight={30}
        onLayoutChange={(l: DashboardLayoutItem[]) => dash.setLayout(l)}
        draggableHandle=".widget-drag-handle"
        margin={[16, 16]}
      >
        {visible.map((id) => {
          const W = widgetRegistry[id].Component;
          return <div key={id}><W /></div>;
        })}
      </RGL>

      <Dialog open={paletteOpen} onOpenChange={setPaletteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add Widget</DialogTitle></DialogHeader>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto py-2">
            {widgetList.filter((w) => w.permission === null || perms.has(w.permission)).map((w) => (
              <div key={w.id} onClick={() => toggleWidget(w.id)} data-testid={`widget-option-${w.id}`}
                className={cn("flex cursor-pointer items-center justify-between rounded-xl border p-3.5 transition-all",
                  dash.activeWidgets.includes(w.id) ? "border-primary/50 bg-primary/5" : "border-border hover:bg-muted/50")}>
                <div>
                  <p className="text-sm font-medium text-foreground">{w.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{w.description}</p>
                </div>
                {dash.activeWidgets.includes(w.id) && <div className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">Active</div>}
              </div>
            ))}
          </div>
          <div className="flex justify-end pt-2"><Button variant="outline" onClick={() => setPaletteOpen(false)}>Close</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <PermissionGuard permission="View Dashboard">
      <DashboardContent />
    </PermissionGuard>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @workspace/web typecheck`
Expected: no errors.

- [ ] **Step 5: Manual dogfood**

Run: `pnpm --filter @workspace/web dev`, log in, open `/`. Verify: default widgets render, drag persists across reload (DB), Add-Widget toggles a widget and it survives reload, and a `Viewer` login without `View Cost` does not see the Cost/Profit/Margin widgets in the palette.

- [ ] **Step 6: Commit**

```bash
git add app/components/dashboard/widget-registry.tsx app/lib/dashboard/use-dashboard-layout.ts "app/app/(dashboard)/page.tsx"
git commit -m "feat(dashboard): registry-driven grid + per-account persistence + role-gated palette"
```

---

# Phase 2 — KPI truth & time context

### Task 8: Prior-period range math (pure)

**Files:**
- Create: `app/lib/analytics/date-range.ts`
- Test: `app/lib/analytics/date-range.test.ts`

- [ ] **Step 1: Write the failing test**

`app/lib/analytics/date-range.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { priorRange } from "./date-range";

describe("priorRange", () => {
  it("returns the immediately preceding equal-length window (inclusive dates)", () => {
    // 2026-06-01..2026-06-30 is 30 days → prior is 2026-05-02..2026-05-31
    expect(priorRange("2026-06-01", "2026-06-30")).toEqual({ from: "2026-05-02", to: "2026-05-31" });
  });
  it("handles a single-day range", () => {
    expect(priorRange("2026-06-10", "2026-06-10")).toEqual({ from: "2026-06-09", to: "2026-06-09" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @workspace/web exec vitest run app/lib/analytics/date-range.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`app/lib/analytics/date-range.ts`:
```ts
const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Inclusive [from,to] → the equal-length window ending the day before `from`. */
export function priorRange(from: string, to: string): { from: string; to: string } {
  const start = new Date(from + "T00:00:00Z").getTime();
  const end = new Date(to + "T00:00:00Z").getTime();
  const lenDays = Math.round((end - start) / DAY) + 1;
  const priorTo = new Date(start - DAY);
  const priorFrom = new Date(priorTo.getTime() - (lenDays - 1) * DAY);
  return { from: iso(priorFrom), to: iso(priorTo) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @workspace/web exec vitest run app/lib/analytics/date-range.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/analytics/date-range.ts app/lib/analytics/date-range.test.ts
git commit -m "feat(analytics): prior-period range helper"
```

---

### Task 9: Real deltas in the dashboard endpoint

**Files:**
- Modify: `app/app/api/analytics/dashboard/route.ts`
- Test: `app/app/api/analytics/dashboard/route.test.ts` (extend existing)

Design: totals keep today's semantics (respect `dateFrom`/`dateTo`, all-time if absent — **non-breaking** for the analytics Profitability tab). Deltas are computed **only when both `dateFrom` and `dateTo` are present**: sum the same conditions over `priorRange(dateFrom, dateTo)` and return `percentDelta`. When absent, deltas stay `null`.

- [ ] **Step 1: Add a failing test**

Add to `app/app/api/analytics/dashboard/route.test.ts` (follow the file's existing mocking of `@workspace/db`):
```ts
it("returns non-null revenue/profit/cost deltas when a date range is supplied", async () => {
  // Arrange the db mock so the first aggregate (current) and the prior aggregate differ,
  // e.g. current revenue=200, prior revenue=100 → revenueChange=100.
  const res = await GET(new Request("http://x/api/analytics/dashboard?dateFrom=2026-06-01&dateTo=2026-06-30"));
  const body = await res.json();
  expect(body.revenueChange).toBeCloseTo(100);
  expect(body.profitChange).not.toBeNull();
  expect(body.costChange).not.toBeNull();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @workspace/web exec vitest run app/app/api/analytics/dashboard/route.test.ts -t "deltas"`
Expected: FAIL — deltas are `null`.

- [ ] **Step 3: Implement**

In `app/app/api/analytics/dashboard/route.ts`: extract the current aggregate `select` into a helper `sumWith(conditions)`; when `qp.data.dateFrom && qp.data.dateTo`, build prior conditions with `buildTransactionConditions({ ...same filters, dateFrom: prior.from, dateTo: prior.to })`, run `sumWith` for both, and compute:
```ts
import { priorRange } from "@/lib/analytics/date-range";
import { percentDelta } from "@/lib/analytics/metrics";
// ...
let revenueChange: number | null = null, profitChange: number | null = null, costChange: number | null = null;
if (qp.data.dateFrom && qp.data.dateTo) {
  const prior = priorRange(qp.data.dateFrom, qp.data.dateTo);
  const priorConditions = buildTransactionConditions({
    dateFrom: prior.from, dateTo: prior.to,
    clientIds: parseIdList(qp.data.clientIds),
    partnerIds: parseIdList(qp.data.partnerIds),
    buyingHouseIds: parseIdList(qp.data.buyingHouseIds),
  });
  const priorAgg = await sumWith(priorConditions.length ? and(...priorConditions) : undefined);
  revenueChange = percentDelta(totalRevenue, parseFloat(priorAgg?.totalRevenue ?? "0"));
  profitChange = percentDelta(totalProfit, parseFloat(priorAgg?.totalProfit ?? "0"));
  costChange = percentDelta(totalCost, parseFloat(priorAgg?.totalCost ?? "0"));
}
```
Return these in place of the hardcoded `null`s. (`percentDelta` already exists in `app/lib/analytics/metrics.ts`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @workspace/web exec vitest run app/app/api/analytics/dashboard/route.test.ts`
Expected: PASS (existing + new).

- [ ] **Step 5: Commit**

```bash
git add app/app/api/analytics/dashboard/route.ts app/app/api/analytics/dashboard/route.test.ts
git commit -m "feat(analytics): real prior-period deltas in dashboard summary"
```

---

### Task 10: Compact date-range control + wiring

**Files:**
- Create: `app/components/dashboard/DashboardDateRange.tsx`
- Modify: `app/app/(dashboard)/page.tsx` (header + pass range to widgets)
- Modify: KPI/trend widget files to accept an optional `params` prop

- [ ] **Step 1: Build the control**

`app/components/dashboard/DashboardDateRange.tsx` — a preset dropdown (MTD · Last 30 · QTD · YTD · Custom) that computes `{ dateFrom, dateTo }` ISO strings and calls `onChange`. Use the existing `Select` primitive (`@/components/ui/select`) and, for Custom, `react-day-picker` (already a dependency). Default preset: **MTD**. Store the choice in React state in the page.

```tsx
"use client";
import { useMemo } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type DashRange = { dateFrom: string; dateTo: string };
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function computePreset(key: string, now = new Date()): DashRange {
  const to = iso(now);
  if (key === "last30") return { dateFrom: iso(new Date(now.getTime() - 29 * 86400000)), dateTo: to };
  if (key === "ytd") return { dateFrom: iso(new Date(Date.UTC(now.getUTCFullYear(), 0, 1))), dateTo: to };
  if (key === "qtd") { const q = Math.floor(now.getUTCMonth() / 3) * 3; return { dateFrom: iso(new Date(Date.UTC(now.getUTCFullYear(), q, 1))), dateTo: to }; }
  // mtd
  return { dateFrom: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))), dateTo: to };
}

export function DashboardDateRange({ value, onChange }: { value: string; onChange: (key: string, range: DashRange) => void }) {
  const range = useMemo(() => computePreset(value), [value]);
  return (
    <Select value={value} onValueChange={(k) => onChange(k, computePreset(k))}>
      <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="mtd">Month to date</SelectItem>
        <SelectItem value="last30">Last 30 days</SelectItem>
        <SelectItem value="qtd">Quarter to date</SelectItem>
        <SelectItem value="ytd">Year to date</SelectItem>
      </SelectContent>
    </Select>
  );
}
```
Add a unit test `DashboardDateRange.test.ts` asserting `computePreset("mtd", new Date("2026-07-21"))` returns `{ dateFrom: "2026-07-01", dateTo: "2026-07-21" }` and `last30` returns a 30-day span.

- [ ] **Step 2: Thread the range through the page + widgets**

In `page.tsx`: hold `const [rangeKey, setRangeKey] = useState("mtd")` and `const [range, setRange] = useState(() => computePreset("mtd"))`; render `<DashboardDateRange>` in the header next to Add-Widget; pass `range` into a React context (`DashboardRangeContext`) that the range-aware widgets read. KPI (`useGetDashboardSummary`), profit trend (`useGetProfitOverTime`), client/platform, and forecast widgets read the context and pass `{ dateFrom, dateTo }` as the hook params (`useGetDashboardSummary(range as never)`), so deltas populate.

- [ ] **Step 3: Typecheck + test + dogfood**

Run: `pnpm --filter @workspace/web exec vitest run app/components/dashboard/DashboardDateRange.test.ts`
Run: `pnpm --filter @workspace/web typecheck`
Dogfood: change the range → KPI values and the green/red delta chips update.

- [ ] **Step 4: Commit**

```bash
git add app/components/dashboard/DashboardDateRange.tsx app/components/dashboard/DashboardDateRange.test.ts "app/app/(dashboard)/page.tsx" app/components/dashboard/widgets
git commit -m "feat(dashboard): compact date-range control wired to KPI/trend deltas"
```

---

# Phase 3 — Insight widgets

Each task: create the widget file, add one registry entry, typecheck, dogfood, commit. All reuse existing analytics components with the exact prop bindings verified from the analytics tabs.

### Task 11: AI "What changed" strip

**Files:** Create `app/components/dashboard/widgets/AiInsights.tsx`; Modify `widget-registry.tsx`.

- [ ] **Step 1: Widget**
```tsx
"use client";
import { useGetAiInsights } from "@workspace/api-client-react";
import { AiInsightStrip } from "@/components/analytics/AiInsightStrip";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";

export function AiInsights() {
  const { data, isLoading } = useGetAiInsights();
  return (
    <DashboardWidget title="What changed" isEmpty={!isLoading && (!data || data.length === 0)} loading={isLoading}>
      <AiInsightStrip insights={data ?? []} />
    </DashboardWidget>
  );
}
```
- [ ] **Step 2: Register** — add to `widgetRegistry`:
```ts
"ai-insights": { id: "ai-insights", label: "AI: What changed", description: "Auto-generated insight cards", category: "risk", permission: "View Analytics", defaultLayout: { w: 12, h: 5, minW: 6, minH: 4 }, Component: AiInsights },
```
- [ ] **Step 3:** `pnpm --filter @workspace/web typecheck` → dogfood the widget renders/adds.
- [ ] **Step 4:** `git commit -m "feat(dashboard): AI what-changed widget"`

### Task 12: Revenue concentration (Pareto + HHI)

**Files:** Create `app/components/dashboard/widgets/Concentration.tsx`; Modify registry.
- [ ] **Step 1: Widget**
```tsx
"use client";
import { useGetConcentration } from "@workspace/api-client-react";
import { ParetoChart } from "@/components/analytics/charts/ParetoChart";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";

export function Concentration() {
  const { data, isLoading } = useGetConcentration();
  return (
    <DashboardWidget title="Revenue concentration" loading={isLoading} isEmpty={!isLoading && !data?.points?.length}>
      <ParetoChart points={data?.points ?? []} hhi={data?.hhi} top5Pct={data?.top5Pct} />
    </DashboardWidget>
  );
}
```
- [ ] **Step 2: Register**
```ts
"concentration": { id: "concentration", label: "Concentration", description: "Top-client Pareto + HHI", category: "relationships", permission: "View Analytics", defaultLayout: { w: 6, h: 9, minW: 4, minH: 6 }, Component: Concentration },
```
- [ ] **Step 3:** typecheck + dogfood. **Step 4:** `git commit -m "feat(dashboard): revenue concentration widget"`

### Task 13: Profit + revenue forecast band

**Files:** Create `app/components/dashboard/widgets/ForecastTrend.tsx`; Modify registry.
- [ ] **Step 1: Widget** (reads the range context from Task 10)
```tsx
"use client";
import { useGetForecast } from "@workspace/api-client-react";
import { ForecastChart } from "@/components/analytics/charts/ForecastChart";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";

export function ForecastTrend() {
  const { data, isLoading } = useGetForecast();
  return (
    <DashboardWidget title="Profit trend & forecast" loading={isLoading} isEmpty={!isLoading && !data?.history?.length}>
      <ForecastChart history={data?.history ?? []} forecast={data?.forecast ?? []} />
    </DashboardWidget>
  );
}
```
- [ ] **Step 2: Register**
```ts
"forecast-trend": { id: "forecast-trend", label: "Forecast", description: "Trend + projection band", category: "profitability", permission: null, defaultLayout: { w: 8, h: 9, minW: 4, minH: 6 }, Component: ForecastTrend },
```
- [ ] **Step 3:** typecheck + dogfood. **Step 4:** `git commit -m "feat(dashboard): profit forecast widget"`

### Task 14: Anomaly watch

**Files:** Create `app/components/dashboard/widgets/Anomalies.tsx`; Modify registry.
- [ ] **Step 1: Widget**
```tsx
"use client";
import { useGetAnomalies } from "@workspace/api-client-react";
import { AnomalyChart } from "@/components/analytics/charts/AnomalyChart";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";

export function Anomalies() {
  const { data, isLoading } = useGetAnomalies();
  return (
    <DashboardWidget title="Anomaly watch" loading={isLoading} isEmpty={!isLoading && !data?.length}>
      <AnomalyChart points={data ?? []} />
    </DashboardWidget>
  );
}
```
- [ ] **Step 2: Register**
```ts
"anomalies": { id: "anomalies", label: "Anomaly watch", description: "Outliers vs pattern", category: "risk", permission: "View Analytics", defaultLayout: { w: 6, h: 9, minW: 4, minH: 6 }, Component: Anomalies },
```
- [ ] **Step 3:** typecheck + dogfood. **Step 4:** `git commit -m "feat(dashboard): anomaly watch widget"`

---

# Phase 4 — Financial-ops widgets

### Task 15: Cash-flow timeline

**Files:** Create `app/components/dashboard/widgets/CashFlow.tsx`; Modify registry.
- [ ] **Step 1: Widget**
```tsx
"use client";
import { useGetCashFlow } from "@workspace/api-client-react";
import { CashFlowChart } from "@/components/analytics/charts/CashFlowChart";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";

export function CashFlow() {
  const { data, isLoading } = useGetCashFlow();
  return (
    <DashboardWidget title="Cash flow" loading={isLoading} isEmpty={!isLoading && !data?.length}>
      <CashFlowChart buckets={data ?? []} />
    </DashboardWidget>
  );
}
```
- [ ] **Step 2: Register** — `permission: "View Payments"`, `defaultLayout: { w: 8, h: 9, minW: 4, minH: 6 }`, id `"cashflow"`, category `"financial-ops"`. **Step 3:** typecheck + dogfood. **Step 4:** `git commit -m "feat(dashboard): cash-flow widget"`

### Task 16: AR / AP aging

**Files:** Create `app/components/dashboard/widgets/Aging.tsx`; Modify registry.
- [ ] **Step 1: Widget**
```tsx
"use client";
import { useGetAging } from "@workspace/api-client-react";
import { AgingBars } from "@/components/analytics/charts/AgingBars";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";

const empty = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };

export function Aging() {
  const { data, isLoading } = useGetAging();
  return (
    <DashboardWidget title="AR / AP aging" loading={isLoading} isEmpty={!isLoading && !data}>
      <div className="grid h-full grid-rows-2 gap-3">
        <AgingBars buckets={data?.ar ?? empty} title="Receivables (AR)" />
        <AgingBars buckets={data?.ap ?? empty} title="Payables (AP)" />
      </div>
    </DashboardWidget>
  );
}
```
- [ ] **Step 2: Register** — id `"aging"`, `permission: "View Payments"`, category `"financial-ops"`, `defaultLayout: { w: 6, h: 10, minW: 4, minH: 6 }`. **Step 3:** typecheck + dogfood. **Step 4:** `git commit -m "feat(dashboard): AR/AP aging widget"`

### Task 17: Invoice status funnel

**Files:** Create `app/components/dashboard/widgets/InvoiceFunnel.tsx`; Modify registry.
- [ ] **Step 1: Widget**
```tsx
"use client";
import { useGetInvoiceFunnel } from "@workspace/api-client-react";
import { StatusFunnel } from "@/components/analytics/charts/StatusFunnel";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";

export function InvoiceFunnel() {
  const { data, isLoading } = useGetInvoiceFunnel();
  return (
    <DashboardWidget title="Invoice status" loading={isLoading} isEmpty={!isLoading && !data?.byStatus?.length}>
      <StatusFunnel byStatus={data?.byStatus ?? []} byCollection={data?.byCollection ?? []} />
    </DashboardWidget>
  );
}
```
- [ ] **Step 2: Register** — id `"invoice-funnel"`, `permission: "View Billings"`, category `"financial-ops"`, `defaultLayout: { w: 6, h: 8, minW: 4, minH: 5 }`. **Step 3:** typecheck + dogfood. **Step 4:** `git commit -m "feat(dashboard): invoice status funnel widget"`

### Task 18: PPO pacing

**Files:** Create `app/components/dashboard/widgets/PoPacing.tsx`; Modify registry.
- [ ] **Step 1: Widget**
```tsx
"use client";
import { useGetPoPacing } from "@workspace/api-client-react";
import { PoBurnDownChart } from "@/components/analytics/charts/PoBurnDownChart";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";

export function PoPacing() {
  const { data, isLoading } = useGetPoPacing();
  return (
    <DashboardWidget title="PO pacing" loading={isLoading} isEmpty={!isLoading && !data?.length}>
      <PoBurnDownChart pos={data ?? []} />
    </DashboardWidget>
  );
}
```
- [ ] **Step 2: Register** — id `"po-pacing"`, `permission: "View Purchase Orders"`, category `"financial-ops"`, `defaultLayout: { w: 6, h: 9, minW: 4, minH: 6 }`. **Step 3:** typecheck + dogfood. **Step 4:** `git commit -m "feat(dashboard): PPO pacing widget"`

### Task 19: Cash Position KPI

**Files:** Create `app/components/dashboard/widgets/KpiCashPosition.tsx`; Modify registry.
- [ ] **Step 1: Widget** — reuse the current page's cash-position math (AR base − AP base via `convertTo`) feeding `KpiCard`:
```tsx
"use client";
import { Wallet } from "lucide-react";
import { useGetAging } from "@workspace/api-client-react";
import { KpiCard } from "@/components/analytics/KpiCard";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";
import { formatMoney, convertTo, DEFAULT_RATES } from "@/lib/analytics/currency";

const sum = (b?: Record<string, number>) => (b ? b["0-30"] + b["31-60"] + b["61-90"] + b["90+"] : 0);

export function KpiCashPosition() {
  const { data: aging, isLoading } = useGetAging();
  const baseCurrency = typeof window !== "undefined" ? localStorage.getItem("adops-base-currency") || "USD" : "USD";
  const rawRates = typeof window !== "undefined" ? localStorage.getItem("adops-exchange-rates") : null;
  const rates = rawRates ? JSON.parse(rawRates) : DEFAULT_RATES;
  const cash = convertTo(sum(aging?.ar), "PKR", rates) - convertTo(sum(aging?.ap), "USD", rates);
  return (
    <DashboardWidget fill={false}>
      <KpiCard title="Cash Position" value={formatMoney(cash, baseCurrency)} icon={<Wallet className="h-4 w-4" />} loading={isLoading} />
    </DashboardWidget>
  );
}
```
- [ ] **Step 2: Register** — id `"cash-position-kpi"`, `permission: "View Payments"`, category `"kpi"`, `defaultLayout: { w: 3, h: 3, minW: 2, minH: 2 }`. **Step 3:** typecheck + dogfood. **Step 4:** `git commit -m "feat(dashboard): cash position KPI widget"`

---

# Phase 5 — Presets, remaining widgets & polish

### Task 20: Focus presets

**Files:**
- Create: `app/lib/dashboard/presets.ts`
- Test: `app/lib/dashboard/presets.test.ts`
- Modify: `app/lib/dashboard/resolve-layout.ts` (drop the temporary `EXEC_PRESET`), `app/lib/dashboard/use-dashboard-layout.ts` (import from presets), `app/app/(dashboard)/page.tsx` (Focus dropdown)

- [ ] **Step 1: Write the failing test**

`app/lib/dashboard/presets.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { PRESETS, resolvePreset } from "./presets";
import { widgetRegistry } from "@/components/dashboard/widget-registry";

describe("presets", () => {
  it("only reference registered widget ids", () => {
    for (const p of Object.values(PRESETS))
      for (const id of p.activeWidgets) expect(widgetRegistry[id]).toBeDefined();
  });
  it("resolvePreset filters out widgets the user lacks permission for", () => {
    const r = resolvePreset("exec", (perm) => perm !== "View Cost");
    expect(r.activeWidgets).not.toContain("cost-kpi");
    expect(r.activeWidgets).not.toContain("profit-kpi");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @workspace/web exec vitest run app/lib/dashboard/presets.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`app/lib/dashboard/presets.ts` — each preset lists `activeWidgets`; layout is generated from each widget's `defaultLayout` (stacked, RGL auto-packs via `x:0,y:Infinity`). `resolvePreset` filters by permission via the same rule as `role-gating`.
```ts
import type { SavedDashboard } from "./types";
import { widgetRegistry } from "@/components/dashboard/widget-registry";

export const PRESETS: Record<"exec" | "ops" | "finance", { activeWidgets: string[] }> = {
  exec: { activeWidgets: ["revenue-kpi", "profit-kpi", "margin-kpi", "cash-position-kpi", "ai-insights", "forecast-trend", "concentration", "working-capital", "alerts-panel"] },
  ops: { activeWidgets: ["revenue-kpi", "profit-kpi", "margin-kpi", "po-pacing", "platform-performance-chart", "anomalies", "transactions-table", "alerts-panel"] },
  finance: { activeWidgets: ["cash-position-kpi", "working-capital", "cashflow", "aging", "invoice-funnel", "transactions-table"] },
};

export function resolvePreset(key: keyof typeof PRESETS, has: (p: string) => boolean): SavedDashboard {
  const activeWidgets = PRESETS[key].activeWidgets.filter((id) => {
    const def = widgetRegistry[id];
    return def && (def.permission === null || has(def.permission));
  });
  const layout = activeWidgets.map((id) => ({ i: id, x: 0, y: Infinity, ...pick(widgetRegistry[id].defaultLayout) }));
  return { activeWidgets, layout, preset: key };
}
function pick(d: { w: number; h: number; minW: number; minH: number }) { return { w: d.w, h: d.h, minW: d.minW, minH: d.minH }; }

export const EXEC_PRESET: SavedDashboard = { ...PRESETS.exec, layout: [], preset: "exec" } as unknown as SavedDashboard;
```

Then in `use-dashboard-layout.ts`, replace the fallback: when both server and local are null, use `resolvePreset("exec", has)` (pass a `has` obtained from `usePermissionSet`) instead of the placeholder `EXEC_PRESET`. Update the `resolveInitialDashboard` fallback argument accordingly and remove the temporary inline `EXEC_PRESET` from `resolve-layout.ts`.

- [ ] **Step 4: Add the Focus dropdown to the page**

In the header, add a `Select` of Exec/Ops/Finance that calls `dash.applyPreset(resolvePreset(key, perms.has))`.

- [ ] **Step 5: Run tests + typecheck + dogfood**

Run: `pnpm --filter @workspace/web exec vitest run app/lib/dashboard/presets.test.ts`
Run: `pnpm --filter @workspace/web typecheck`
Dogfood: apply each preset; confirm it swaps widgets and persists; confirm a Viewer without `View Cost` gets a Cost-free Exec preset.

- [ ] **Step 6: Commit**

```bash
git add app/lib/dashboard/presets.ts app/lib/dashboard/presets.test.ts app/lib/dashboard/resolve-layout.ts app/lib/dashboard/use-dashboard-layout.ts "app/app/(dashboard)/page.tsx"
git commit -m "feat(dashboard): Exec/Ops/Finance focus presets"
```

---

### Task 21: Remaining relationship/profitability widgets

**Files:** Create `app/components/dashboard/widgets/{RevenueMix,MarginQuadrantWidget,ProfitWaterfall,FraudTrend,NeedsAttention}.tsx`; Modify registry.

- [ ] **Step 1: Revenue mix treemap** (`useGetMarginMatrix` → `matrix.cells`)
```tsx
"use client";
import { useGetMarginMatrix } from "@workspace/api-client-react";
import { RevenueTreemap } from "@/components/analytics/charts/RevenueTreemap";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";
export function RevenueMix() {
  const { data, isLoading } = useGetMarginMatrix();
  return (
    <DashboardWidget title="Revenue mix" loading={isLoading} isEmpty={!isLoading && !data?.cells?.length}>
      <RevenueTreemap cells={data?.cells ?? []} />
    </DashboardWidget>
  );
}
```
- [ ] **Step 2: Margin quadrant** (`useGetAnalyticsByClient` → map to `points`)
```tsx
"use client";
import { useGetAnalyticsByClient } from "@workspace/api-client-react";
import { MarginQuadrant } from "@/components/analytics/charts/MarginQuadrant";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";
export function MarginQuadrantWidget() {
  const { data, isLoading } = useGetAnalyticsByClient();
  return (
    <DashboardWidget title="Revenue × margin" loading={isLoading} isEmpty={!isLoading && !data?.length}>
      <MarginQuadrant points={(data ?? []).map((c) => ({ clientName: c.clientName, revenue: c.revenue, marginPct: c.marginPct }))} />
    </DashboardWidget>
  );
}
```
- [ ] **Step 3: Profit-leakage waterfall** (`useGetProfitWaterfall` → `stages`)
```tsx
"use client";
import { useGetProfitWaterfall } from "@workspace/api-client-react";
import { WaterfallChart } from "@/components/analytics/charts/WaterfallChart";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";
export function ProfitWaterfall() {
  const { data, isLoading } = useGetProfitWaterfall();
  return (
    <DashboardWidget title="Profit leakage" loading={isLoading} isEmpty={!isLoading && !data?.length}>
      <WaterfallChart stages={(data ?? []) as never} />
    </DashboardWidget>
  );
}
```
- [ ] **Step 4: Fraud trend** (`useGetFraudQuality` → `points`)
```tsx
"use client";
import { useGetFraudQuality } from "@workspace/api-client-react";
import { FraudTrendChart } from "@/components/analytics/charts/FraudTrendChart";
import { DashboardWidget } from "@/components/dashboard/DashboardWidget";
export function FraudTrend() {
  const { data, isLoading } = useGetFraudQuality();
  return (
    <DashboardWidget title="Traffic quality" loading={isLoading} isEmpty={!isLoading && !data?.length}>
      <FraudTrendChart points={data ?? []} />
    </DashboardWidget>
  );
}
```
- [ ] **Step 5: Needs-attention table** — `useListTransactions({ limit: 50 })`, filter to `profit < 0 || (marginPct ?? 100) < 10`, render the same table markup as `RecentTransactions` (title "Needs attention", empty label "Nothing needs attention").
- [ ] **Step 6: Register all five**
```ts
"revenue-mix": { id: "revenue-mix", label: "Revenue mix", description: "Client → partner treemap", category: "relationships", permission: "View Analytics", defaultLayout: { w: 6, h: 9, minW: 4, minH: 6 }, Component: RevenueMix },
"margin-quadrant": { id: "margin-quadrant", label: "Revenue × margin", description: "Bubble quadrant", category: "profitability", permission: "View Cost", defaultLayout: { w: 6, h: 9, minW: 4, minH: 6 }, Component: MarginQuadrantWidget },
"profit-waterfall": { id: "profit-waterfall", label: "Profit leakage", description: "Gross → net waterfall", category: "profitability", permission: "View Cost", defaultLayout: { w: 8, h: 9, minW: 4, minH: 6 }, Component: ProfitWaterfall },
"fraud-trend": { id: "fraud-trend", label: "Traffic quality", description: "Fraud-rate trend", category: "risk", permission: "View Analytics", defaultLayout: { w: 6, h: 8, minW: 4, minH: 5 }, Component: FraudTrend },
"needs-attention": { id: "needs-attention", label: "Needs attention", description: "Loss / low-margin transactions", category: "activity", permission: "View Transactions", defaultLayout: { w: 12, h: 8, minW: 6, minH: 5 }, Component: NeedsAttention },
```
- [ ] **Step 7:** `pnpm --filter @workspace/web typecheck` → dogfood each. **Step 8:** `git commit -m "feat(dashboard): treemap, quadrant, waterfall, fraud, needs-attention widgets"`

---

### Task 22: Palette grouping, dataviz pass & final verification

**Files:** Modify `app/app/(dashboard)/page.tsx` (group palette by `category`); optional palette polish.

- [ ] **Step 1: Group the Add-Widget palette by category**

In the palette dialog, group `widgetList` by `def.category` with a small section header per group (`kpi`, `profitability`, `financial-ops`, `relationships`, `risk`, `activity`). Keep the permission filter.

- [ ] **Step 2: Dataviz consistency**

Invoke the `dataviz` skill and confirm the new widgets read as one system in light and dark themes (the reused analytics charts already follow it; verify the KPI Cash Position tile and Needs-attention table colors match). Adjust any off-palette colors.

- [ ] **Step 3: Full test + typecheck sweep**

Run: `pnpm --filter @workspace/web exec vitest run`
Expected: all suites pass.
Run: `pnpm --filter @workspace/web typecheck`
Expected: no errors.

- [ ] **Step 4: End-to-end dogfood (per persona)**

- System Admin: every widget appears in the palette; all three presets apply; layout persists across reload and across a second browser (DB-backed).
- Operator without `View Cost` (if configured): Cost/Profit/Margin/quadrant/waterfall widgets are absent from palette and never render; Exec preset applied yields a Cost-free layout.
- Legacy user with existing `localStorage` layout: first load migrates it to the DB and clears the local keys.

- [ ] **Step 5: Commit**

```bash
git add "app/app/(dashboard)/page.tsx"
git commit -m "feat(dashboard): grouped widget palette + dataviz consistency pass"
```

---

## Self-review notes (author)

- **Spec coverage:** §4 framework → Tasks 4–7; §5 catalog → Tasks 6 (ported), 11–19, 21 (every catalog row mapped to a task with its verified hook/component/permission); §6 KPI truth/time → Tasks 8–10; §7 persistence → Tasks 1–3, 7; §8 presets → Task 20; §9 states/resilience → Task 5 shell + per-widget `isEmpty`/`loading`; §11 testing → route test (Task 2), pure-fn tests (Tasks 3,4,8,20), delta route test (Task 9), preset integrity (Task 20), plus typecheck + persona dogfood.
- **Type consistency:** `WidgetDef`/`WidgetId`/`SavedDashboard`/`DashboardLayoutItem` defined in Task 3 and used unchanged throughout; `usePermissionSet().has` used identically in role-gating, palette, and presets; `resolvePreset(key, has)` signature stable between Task 20 definition and its page/hook callers.
- **Known follow-up flagged in-task:** the temporary `EXEC_PRESET` in `resolve-layout.ts` (Task 7) is explicitly removed in Task 20 — do not leave both.
- **Verify before finishing:** `WidgetErrorBoundary` prop name (Task 5) and each analytics chart's response-field names (`concentration.points/hhi/top5Pct`, `forecast.history/forecast`, `funnel.byStatus/byCollection`, `aging.ar/ap`) — all captured from the analytics tabs, but confirm against the live hook return types during implementation.