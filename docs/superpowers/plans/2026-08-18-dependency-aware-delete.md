# Dependency-Aware Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every blind delete in the app with a modal that shows the full impact tree — what blocks the delete, what will be silently cascade-deleted, what will be unlinked — and lets the user clear blockers one-by-one in place or delete the whole tree in one RBAC-gated transaction.

**Architecture:** The foreign-key graph is derived automatically at module load from Drizzle schema metadata (`getTableConfig().foreignKeys`), so it can never drift from the schema. A small hand-written descriptor registry supplies only presentation and permission metadata per table. A resolver walks the graph to build an `Impact` tree, served by `GET /api/dependencies`. Bulk deletion goes through `POST /api/dependencies/delete`, which re-resolves server-side, re-checks permissions, and deletes bottom-up in a single transaction. Per-row deletes in the modal reuse the entity's existing `DELETE` route.

**Tech Stack:** TypeScript, Next.js 15 App Router, Drizzle ORM 0.45.2 (node-postgres), Postgres, Zod, TanStack Query, orval codegen, Radix UI, Tailwind, Vitest 3.2.6.

**Spec:** `docs/superpowers/specs/2026-08-17-dependency-aware-delete-design.md`

## Global Constraints

- **Package manager is pnpm.** `npx only-allow pnpm` is enforced in `preinstall`. Never use npm or yarn.
- **Tests run from `app/`:** `pnpm test` (which is `vitest run`). Run a single file with `pnpm exec vitest run <path>`.
- **Typecheck:** `pnpm typecheck` from the repo root (builds libs, then typechecks `app` and `scripts`).
- **API contract flow is one-directional:** `lib/db/src/schema/*` → `lib/api-spec/openapi.yaml` → orval generates `lib/api-zod` + `lib/api-client-react` → `app/app/api/*` route handlers → `app/app/(dashboard)/*` pages. **Never hand-edit anything under `lib/api-zod/src/generated` or `lib/api-client-react/src/generated`** — edit `openapi.yaml` and run codegen.
- **Codegen command:** `pnpm --filter @workspace/api-spec codegen`.
- **Do not change any FK policy** in `lib/db/src/schema/*`. This feature reports what the schema already declares.
- **Do not change any existing route's permission slug.** The descriptor registry records current behavior verbatim, including `payments/[id]` DELETE gating on `payments:edit`.
- **Every route handler starts with a permission guard** using `requirePermission(...)` / `isAuthError(...)` from `@/lib/auth/require`. Follow the existing pattern exactly.
- **`Permission` is a union type** from `@/lib/rbac/catalog`. Any permission string stored in the descriptor registry must be typed `Permission`, so a typo fails typecheck.
- Commit after every task. Conventional commit prefixes (`feat:`, `test:`, `refactor:`, `docs:`).

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `lib/db/src/dependency-graph.ts` | Pure FK graph derived from Drizzle schema. No app concerns. |
| `lib/db/src/dependency-graph.test.ts` | Asserts known schema facts so FK policy changes fail loudly. |
| `app/lib/dependencies/descriptors.ts` | Hand-written per-table presentation + permission registry. |
| `app/lib/dependencies/descriptors.test.ts` | Completeness check — fails CI when a table has no descriptor. |
| `app/lib/dependencies/types.ts` | Shared `ImpactNode` / `Impact` types used by resolver, routes, and UI. |
| `app/lib/dependencies/resolve.ts` | Walks the graph, builds the `Impact` tree, computes fingerprint. |
| `app/lib/dependencies/resolve.test.ts` | Depth cap, row cap, transitive counting, permission gating, fingerprint. |
| `app/lib/dependencies/fingerprint.ts` | Stable hash over a tree's node set. |
| `app/app/api/dependencies/route.ts` | `GET` — resolve and return the impact tree. |
| `app/app/api/dependencies/route.test.ts` | Guard, validation, unknown-table rejection. |
| `app/app/api/dependencies/delete/route.ts` | `POST` — transactional bottom-up cascade delete. |
| `app/app/api/dependencies/delete/route.test.ts` | 409 fingerprint mismatch, 403 permissions, rollback. |
| `app/components/ui/delete-impact-dialog.tsx` | The modal: three sections, inline row confirm, two-screen Delete All. |
| `app/components/ui/delete-impact-dialog.test.tsx` | Empty-impact fallback, locked rows, typed confirmation. |
| `app/hooks/use-delete-with-dependencies.ts` | Single entry point replacing every `confirm()` call site. |

**Modified:**

| Path | Change |
|---|---|
| `app/vitest.config.ts` | Extend `include` to cover `../lib/**/*.test.ts`. |
| `lib/db/src/index.ts` | Re-export the dependency graph. |
| `lib/api-spec/openapi.yaml` | Add the two `/dependencies` endpoints + schemas. |
| `app/app/(dashboard)/buying-houses/page.tsx:122` | Migrate delete call site to the new hook. |
| `app/app/(dashboard)/clients/page.tsx` | Migrate delete call site. |
| `app/app/(dashboard)/partners/page.tsx` | Migrate delete call site. |
| `app/components/billings/ClientBillingSummaryTab.tsx:140` | Replace native `confirm()`. |
| Remaining 13 `DELETE` route handlers | Generalize the `23503` safety net. |

---

## Behavior change to be aware of

**Cascade groups are permission-gated, not just blockers.** Deleting a partner cascades every `billing_record` it owns. Today `partners:delete` alone is enough to destroy that billing data. Under this design, the operation also requires the cascade target's permission (`billings:edit` for `billing_records`), otherwise `canDeleteAll` is false.

This is a deliberate tightening — closing the exact hole the feature exists to expose — but it **will** block users who could previously delete partners. Task 3 implements it; if the user wants the old behavior, restrict the permission check to blocker nodes only and drop cascade groups from `missingPermissions`.

---

### Task 1: FK dependency graph

**Files:**
- Create: `lib/db/src/dependency-graph.ts`
- Create: `lib/db/src/dependency-graph.test.ts`
- Modify: `app/vitest.config.ts`
- Modify: `lib/db/src/index.ts`

**Interfaces:**
- Consumes: `lib/db/src/schema/index.ts` (all table exports); `getTableConfig` from `drizzle-orm/pg-core`; `is`, `getTableName` from `drizzle-orm`.
- Produces: `FkAction`, `FkEdge`, `fkEdges`, `dependentsOf`, `isBlocking`, `allTableNames` — all re-exported from `@workspace/db`.

**Background the implementer needs:** In Drizzle, `column.references(() => other.id, { onDelete })` registers an *inline* foreign key. `getTableConfig(table).foreignKeys` reads `table[PgTable.Symbol.InlineForeignKeys]`, so it returns exactly these. Each `ForeignKey` has `reference()` returning `{ columns, foreignTable, foreignColumns }` and an `onDelete` field that is `undefined` when unspecified. Postgres defaults unspecified to `NO ACTION`, which **blocks** deletes — so `undefined` must normalize to `"no action"` and be treated as blocking. This matters: `billing_records.buying_house_id` has no `onDelete`, and it is the edge behind the one FK error message that already exists in the app.

- [ ] **Step 1: Extend vitest to cover lib tests**

`app/vitest.config.ts` — replace the `include` line:

```ts
    include: ["**/*.test.ts", "**/*.test.tsx", "../lib/**/*.test.ts"],
    exclude: ["node_modules", ".next", "**/node_modules/**"],
```

(Verified working: vitest 3.2.6 resolves the `../lib/**` glob from the `app/` root.)

- [ ] **Step 2: Write the failing test**

Create `lib/db/src/dependency-graph.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fkEdges, dependentsOf, isBlocking, allTableNames } from "./dependency-graph";

function edge(child: string, parent: string) {
  return fkEdges.find(e => e.childTable === child && e.parentTable === parent);
}

describe("dependency graph", () => {
  it("derives restrict edges", () => {
    expect(edge("billings", "clients")?.onDelete).toBe("restrict");
    expect(edge("client_purchase_orders", "clients")?.onDelete).toBe("restrict");
    expect(edge("partner_bills", "partners")?.onDelete).toBe("restrict");
  });

  it("derives cascade edges", () => {
    expect(edge("billing_records", "partners")?.onDelete).toBe("cascade");
    expect(edge("client_events", "clients")?.onDelete).toBe("cascade");
    expect(edge("payment_billings", "payments")?.onDelete).toBe("cascade");
  });

  it("derives set null edges", () => {
    expect(edge("clients", "buying_houses")?.onDelete).toBe("set null");
    expect(edge("billing_records", "clients")?.onDelete).toBe("set null");
  });

  it("normalizes unspecified onDelete to 'no action' and treats it as blocking", () => {
    const e = edge("billing_records", "buying_houses");
    expect(e?.onDelete).toBe("no action");
    expect(isBlocking(e!.onDelete)).toBe(true);
  });

  it("treats restrict as blocking and cascade/set null as non-blocking", () => {
    expect(isBlocking("restrict")).toBe(true);
    expect(isBlocking("cascade")).toBe(false);
    expect(isBlocking("set null")).toBe(false);
  });

  it("indexes dependents by parent table", () => {
    const children = (dependentsOf.get("clients") ?? []).map(e => e.childTable);
    expect(children).toContain("billings");
    expect(children).toContain("client_events");
    expect(children).toContain("client_purchase_orders");
  });

  it("discovers every schema table", () => {
    expect(allTableNames).toContain("billings");
    expect(allTableNames).toContain("dashboard_layouts");
    expect(allTableNames.length).toBeGreaterThanOrEqual(24);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

From `app/`: `pnpm exec vitest run ../lib/db/src/dependency-graph.test.ts`
Expected: FAIL — cannot resolve `./dependency-graph`.

- [ ] **Step 4: Implement the graph**

Create `lib/db/src/dependency-graph.ts`:

```ts
import { is, getTableName } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type FkAction = "cascade" | "restrict" | "set null" | "set default" | "no action";

export type FkEdge = {
  childTable: string;
  childColumn: string;
  parentTable: string;
  parentColumn: string;
  onDelete: FkAction;
};

const tables: PgTable[] = Object.values(schema).filter((v): v is PgTable => is(v, PgTable));

export const allTableNames: readonly string[] = tables.map(getTableName);

export const fkEdges: readonly FkEdge[] = tables.flatMap((table) => {
  const childTable = getTableName(table);
  return getTableConfig(table).foreignKeys.map((fk): FkEdge => {
    const ref = fk.reference();
    if (ref.columns.length !== 1) {
      throw new Error(
        `Composite foreign key on ${childTable} is not supported by the dependency graph`,
      );
    }
    return {
      childTable,
      childColumn: ref.columns[0]!.name,
      parentTable: getTableName(ref.foreignTable),
      parentColumn: ref.foreignColumns[0]!.name,
      // Postgres defaults an unspecified action to NO ACTION, which blocks deletes.
      onDelete: (fk.onDelete ?? "no action") as FkAction,
    };
  });
});

export const dependentsOf: ReadonlyMap<string, FkEdge[]> = (() => {
  const map = new Map<string, FkEdge[]>();
  for (const e of fkEdges) {
    const existing = map.get(e.parentTable);
    if (existing) existing.push(e);
    else map.set(e.parentTable, [e]);
  }
  return map;
})();

/** RESTRICT and NO ACTION both prevent the parent row from being deleted. */
export function isBlocking(action: FkAction): boolean {
  return action === "restrict" || action === "no action";
}
```

- [ ] **Step 5: Re-export from the db package**

Append to `lib/db/src/index.ts`:

```ts
export * from "./dependency-graph";
```

- [ ] **Step 6: Run tests and typecheck**

From `app/`: `pnpm exec vitest run ../lib/db/src/dependency-graph.test.ts`
Expected: PASS, 7 tests.

From repo root: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/db/src/dependency-graph.ts lib/db/src/dependency-graph.test.ts lib/db/src/index.ts app/vitest.config.ts
git commit -m "feat(db): derive foreign-key dependency graph from drizzle schema"
```

---

### Task 2: Descriptor registry

**Files:**
- Create: `app/lib/dependencies/descriptors.ts`
- Create: `app/lib/dependencies/descriptors.test.ts`

**Interfaces:**
- Consumes: `allTableNames`, `fkEdges` from `@workspace/db`; `Permission` from `@/lib/rbac/catalog`.
- Produces: `Descriptor` type, `DESCRIPTORS` record, `getDescriptor(table): Descriptor`, `hasDescriptor(table): boolean`.

**Background:** Permission slugs are **not** derivable from table names. Verified across all 17 handlers: only `buying-houses:delete`, `clients:delete`, `partners:delete` follow `<entity>:delete`. The rest reuse `:edit` or a settings slug. Each descriptor records what that route *already* requires — this task changes no route.

- [ ] **Step 1: Write the failing test**

Create `app/lib/dependencies/descriptors.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { allTableNames } from "@workspace/db";
import { DESCRIPTORS, getDescriptor, hasDescriptor } from "./descriptors";

describe("descriptor registry", () => {
  it("has an entry for every table in the schema", () => {
    const missing = allTableNames.filter(t => !hasDescriptor(t));
    expect(missing).toEqual([]);
  });

  it("has no entries for tables that no longer exist", () => {
    const orphans = Object.keys(DESCRIPTORS).filter(t => !allTableNames.includes(t));
    expect(orphans).toEqual([]);
  });

  it("records the permission each existing route actually requires", () => {
    expect(getDescriptor("clients").deletePermission).toBe("clients:delete");
    expect(getDescriptor("payments").deletePermission).toBe("payments:edit");
    expect(getDescriptor("billings").deletePermission).toBe("billings:edit");
    expect(getDescriptor("cost_models").deletePermission).toBe("settings.catalogs:manage");
  });

  it("marks financial tables so they trigger typed confirmation", () => {
    expect(getDescriptor("billings").financial).toBe(true);
    expect(getDescriptor("payments").financial).toBe(true);
    expect(getDescriptor("partner_bills").financial).toBe(true);
    expect(getDescriptor("clients").financial).toBe(false);
  });

  it("builds a human label from a row", () => {
    expect(getDescriptor("clients").labelWith({ id: 3, name: "Acme" })).toBe("Acme");
    expect(getDescriptor("billings").labelWith({ id: 12, invoiceCode: "CBILL-0012" })).toBe("CBILL-0012");
    expect(getDescriptor("billings").labelWith({ id: 12, invoiceCode: null })).toBe("Billing #12");
  });

  it("always includes id in labelColumns so the resolver selects it", () => {
    for (const t of allTableNames) {
      expect(getDescriptor(t).labelColumns).toContain("id");
    }
  });

  it("throws on an unknown table", () => {
    expect(() => getDescriptor("not_a_table")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

From `app/`: `pnpm exec vitest run lib/dependencies/descriptors.test.ts`
Expected: FAIL — cannot resolve `./descriptors`.

- [ ] **Step 3: Implement the registry**

Create `app/lib/dependencies/descriptors.ts`. Note `str()` coerces unknown row values safely, and every `labelColumns` array includes `"id"` because the resolver selects exactly those columns.

```ts
import type { Permission } from "@/lib/rbac/catalog";

export type Descriptor = {
  singular: string;
  plural: string;
  labelColumns: string[];
  labelWith: (row: Record<string, unknown>) => string;
  href: ((id: number | string) => string) | null;
  deletePermission: Permission;
  deleteEndpoint: ((id: number | string) => string) | null;
  financial: boolean;
};

const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

export const DESCRIPTORS: Record<string, Descriptor> = {
  buying_houses: {
    singular: "Buying House", plural: "Buying Houses",
    labelColumns: ["id", "name"],
    labelWith: r => str(r.name) ?? `Buying House #${r.id}`,
    href: id => `/buying-houses/${id}`,
    deletePermission: "buying-houses:delete",
    deleteEndpoint: id => `/api/buying-houses/${id}`,
    financial: false,
  },
  clients: {
    singular: "Client", plural: "Clients",
    labelColumns: ["id", "name"],
    labelWith: r => str(r.name) ?? `Client #${r.id}`,
    href: id => `/clients/${id}`,
    deletePermission: "clients:delete",
    deleteEndpoint: id => `/api/clients/${id}`,
    financial: false,
  },
  partners: {
    singular: "Partner", plural: "Partners",
    labelColumns: ["id", "name"],
    labelWith: r => str(r.name) ?? `Partner #${r.id}`,
    href: id => `/partners/${id}`,
    deletePermission: "partners:delete",
    deleteEndpoint: id => `/api/partners/${id}`,
    financial: false,
  },
  client_events: {
    singular: "Client Event", plural: "Client Events",
    labelColumns: ["id", "name"],
    labelWith: r => str(r.name) ?? `Event #${r.id}`,
    href: null,
    deletePermission: "clients:edit",
    deleteEndpoint: null, // nested under /api/clients/[id]/events/[eventId]
    financial: false,
  },
  partner_clients: {
    singular: "Partner–Client Link", plural: "Partner–Client Links",
    labelColumns: ["id"],
    labelWith: r => `Link #${r.id}`,
    href: null,
    deletePermission: "partners:edit",
    deleteEndpoint: null,
    financial: false,
  },
  partner_event_payouts: {
    singular: "Partner Payout Rate", plural: "Partner Payout Rates",
    labelColumns: ["id"],
    labelWith: r => `Payout Rate #${r.id}`,
    href: null,
    deletePermission: "partners:edit",
    deleteEndpoint: null,
    financial: false,
  },
  client_purchase_orders: {
    singular: "Client PO", plural: "Client POs",
    labelColumns: ["id", "code"],
    labelWith: r => str(r.code) ?? `Client PO #${r.id}`,
    href: id => `/purchase-orders?cpo=${id}`,
    deletePermission: "purchase-orders:edit",
    deleteEndpoint: id => `/api/client-purchase-orders/${id}`,
    financial: false,
  },
  partner_purchase_orders: {
    singular: "Partner PO", plural: "Partner POs",
    labelColumns: ["id", "code"],
    labelWith: r => str(r.code) ?? `Partner PO #${r.id}`,
    href: id => `/purchase-orders?ppo=${id}`,
    deletePermission: "purchase-orders:edit",
    deleteEndpoint: id => `/api/partner-purchase-orders/${id}`,
    financial: false,
  },
  partner_purchase_order_items: {
    singular: "Partner PO Line", plural: "Partner PO Lines",
    labelColumns: ["id"],
    labelWith: r => `PO Line #${r.id}`,
    href: null,
    deletePermission: "purchase-orders:edit",
    deleteEndpoint: null,
    financial: false,
  },
  billings: {
    singular: "Client Bill", plural: "Client Bills",
    labelColumns: ["id", "invoiceCode"],
    labelWith: r => str(r.invoiceCode) ?? `Billing #${r.id}`,
    href: id => `/billings?billing=${id}`,
    deletePermission: "billings:edit",
    deleteEndpoint: id => `/api/billings/${id}`,
    financial: true,
  },
  billing_lines: {
    singular: "Bill Line", plural: "Bill Lines",
    labelColumns: ["id"],
    labelWith: r => `Bill Line #${r.id}`,
    href: null,
    deletePermission: "billings:edit",
    deleteEndpoint: null,
    financial: true,
  },
  billing_event_items: {
    singular: "Bill Event Item", plural: "Bill Event Items",
    labelColumns: ["id"],
    labelWith: r => `Bill Event Item #${r.id}`,
    href: null,
    deletePermission: "billings:edit",
    deleteEndpoint: null,
    financial: true,
  },
  billing_records: {
    singular: "Billing Record", plural: "Billing Records",
    labelColumns: ["id"],
    labelWith: r => `Billing Record #${r.id}`,
    href: null,
    deletePermission: "billings:edit",
    deleteEndpoint: null,
    financial: true,
  },
  partner_bills: {
    singular: "Partner Bill", plural: "Partner Bills",
    labelColumns: ["id", "code"],
    labelWith: r => str(r.code) ?? `Partner Bill #${r.id}`,
    href: id => `/billings?partnerBill=${id}`,
    deletePermission: "billings:edit",
    deleteEndpoint: id => `/api/partner-bills/${id}`,
    financial: true,
  },
  payments: {
    singular: "Client Payment", plural: "Client Payments",
    labelColumns: ["id", "referenceCode"],
    labelWith: r => str(r.referenceCode) ?? `Payment #${r.id}`,
    href: id => `/payments?payment=${id}`,
    deletePermission: "payments:edit",
    deleteEndpoint: id => `/api/payments/${id}`,
    financial: true,
  },
  partner_payments: {
    singular: "Partner Payment", plural: "Partner Payments",
    labelColumns: ["id", "referenceCode"],
    labelWith: r => str(r.referenceCode) ?? `Partner Payment #${r.id}`,
    href: id => `/payments?partnerPayment=${id}`,
    deletePermission: "payments:edit",
    deleteEndpoint: id => `/api/partner-payments/${id}`,
    financial: true,
  },
  payment_billings: {
    singular: "Payment Allocation", plural: "Payment Allocations",
    labelColumns: ["id"],
    labelWith: r => `Allocation #${r.id}`,
    href: null,
    deletePermission: "payments:edit",
    deleteEndpoint: null,
    financial: true,
  },
  cost_models: {
    singular: "Cost Model", plural: "Cost Models",
    labelColumns: ["id", "name"],
    labelWith: r => str(r.name) ?? `Cost Model #${r.id}`,
    href: null,
    deletePermission: "settings.catalogs:manage",
    deleteEndpoint: id => `/api/cost-models/${id}`,
    financial: false,
  },
  cost_resources: {
    singular: "Cost Resource", plural: "Cost Resources",
    labelColumns: ["id", "name"],
    labelWith: r => str(r.name) ?? `Cost Resource #${r.id}`,
    href: null,
    deletePermission: "cost:edit",
    deleteEndpoint: id => `/api/cost-resources/${id}`,
    financial: false,
  },
  payment_terms: {
    singular: "Payment Term", plural: "Payment Terms",
    labelColumns: ["id", "name"],
    labelWith: r => str(r.name) ?? `Payment Term #${r.id}`,
    href: null,
    deletePermission: "settings.catalogs:manage",
    deleteEndpoint: id => `/api/payment-terms/${id}`,
    financial: false,
  },
  tax_settings: {
    singular: "Tax Setting", plural: "Tax Settings",
    labelColumns: ["id"],
    labelWith: r => `Tax Setting #${r.id}`,
    href: null,
    deletePermission: "settings.catalogs:manage",
    deleteEndpoint: null,
    financial: false,
  },
  users: {
    singular: "User", plural: "Users",
    labelColumns: ["id", "name", "email"],
    labelWith: r => str(r.name) ?? str(r.email) ?? `User #${r.id}`,
    href: null,
    deletePermission: "settings.users:manage",
    deleteEndpoint: null, // keyed by email: /api/users/[email]
    financial: false,
  },
  roles: {
    singular: "Role", plural: "Roles",
    labelColumns: ["id", "name"],
    labelWith: r => str(r.name) ?? `Role #${r.id}`,
    href: null,
    deletePermission: "settings.roles:manage",
    deleteEndpoint: null, // keyed by name: /api/roles/[name]
    financial: false,
  },
  dashboard_layouts: {
    singular: "Dashboard Layout", plural: "Dashboard Layouts",
    labelColumns: ["id"],
    labelWith: r => `Dashboard Layout #${r.id}`,
    href: null,
    deletePermission: "dashboard:view",
    deleteEndpoint: null,
    financial: false,
  },
};

export function hasDescriptor(table: string): boolean {
  return Object.hasOwn(DESCRIPTORS, table);
}

export function getDescriptor(table: string): Descriptor {
  const d = DESCRIPTORS[table];
  if (!d) throw new Error(`No dependency descriptor registered for table "${table}"`);
  return d;
}
```

- [ ] **Step 4: Run test to verify it passes**

From `app/`: `pnpm exec vitest run lib/dependencies/descriptors.test.ts`
Expected: PASS, 7 tests.

If the completeness test fails, it will name the missing table — add a descriptor for it. Column names in `labelColumns` are **Drizzle property names** as they appear in `row` objects; verify against the table's schema file if a label test fails.

- [ ] **Step 5: Commit**

```bash
git add app/lib/dependencies/descriptors.ts app/lib/dependencies/descriptors.test.ts
git commit -m "feat(dependencies): add per-table presentation and permission descriptors"
```

---

### Task 3: Impact resolver

**Files:**
- Create: `app/lib/dependencies/types.ts`
- Create: `app/lib/dependencies/fingerprint.ts`
- Create: `app/lib/dependencies/resolve.ts`
- Create: `app/lib/dependencies/resolve.test.ts`

**Interfaces:**
- Consumes: `dependentsOf`, `isBlocking`, `FkEdge`, `db` from `@workspace/db`; `getDescriptor`, `hasDescriptor` from `./descriptors`.
- Produces:
  - `types.ts`: `ImpactNode`, `CascadeGroup`, `NullifyGroup`, `Impact`, `MAX_DEPTH = 4`, `MAX_ROWS_PER_LEVEL = 50`
  - `fingerprint.ts`: `fingerprintOf(nodes: { table: string; id: number | string }[]): string`
  - `resolve.ts`: `resolveImpact(table: string, id: number | string, permissions: Set<string>): Promise<Impact>`, `collectDeletableNodes(impact: Impact): { table: string; id: number | string }[]`

**Background:** Table and column names are interpolated into SQL, so they **must** come from the graph/descriptors (trusted, schema-derived) and never from request input. Use `sql.identifier()` for them and normal `${}` parameter binding for ids. The route layer rejects unknown tables before calling the resolver.

- [ ] **Step 1: Write the types**

Create `app/lib/dependencies/types.ts`:

```ts
export const MAX_DEPTH = 4;
export const MAX_ROWS_PER_LEVEL = 50;
export const CASCADE_SAMPLE_SIZE = 3;

export type ImpactNode = {
  table: string;
  id: number | string;
  label: string;
  singular: string;
  href: string | null;
  canDelete: boolean;
  requiredPermission: string;
  deleteEndpoint: string | null;
  children: ImpactNode[];
  truncated: boolean;   // more children exist than MAX_ROWS_PER_LEVEL
};

export type CascadeGroup = {
  table: string;
  label: string;         // plural descriptor label
  count: number;         // transitive: includes this table's own cascade descendants
  sample: ImpactNode[];
  canDelete: boolean;
  requiredPermission: string;
};

export type NullifyGroup = {
  table: string;
  column: string;
  label: string;
  count: number;
};

export type Impact = {
  target: { table: string; id: number | string; label: string; singular: string };
  blockers: ImpactNode[];
  cascades: CascadeGroup[];
  nullifies: NullifyGroup[];
  canDeleteAll: boolean;
  blockedReason: string | null;
  missingPermissions: string[];
  totals: { deletes: number; nullifies: number; touchesFinancial: boolean };
  fingerprint: string;
};
```

- [ ] **Step 2: Write the fingerprint helper**

Create `app/lib/dependencies/fingerprint.ts`:

```ts
import { createHash } from "node:crypto";

/** Stable hash over a node set — order-independent, so a re-resolve matches. */
export function fingerprintOf(nodes: { table: string; id: number | string }[]): string {
  const keys = nodes.map(n => `${n.table}:${n.id}`).sort();
  return createHash("sha1").update(keys.join("|")).digest("hex");
}
```

- [ ] **Step 3: Write the failing test**

Create `app/lib/dependencies/resolve.test.ts`. The DB is mocked at the `db.execute` level; each call returns the next queued result.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const execute = vi.fn();

vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<typeof import("@workspace/db")>("@workspace/db");
  return { ...actual, db: { execute: (...a: unknown[]) => execute(...a) } };
});

import { resolveImpact, collectDeletableNodes } from "./resolve";
import { fingerprintOf } from "./fingerprint";

const ALL = new Set([
  "clients:delete", "clients:edit", "billings:edit", "purchase-orders:edit",
  "payments:edit", "partners:delete", "partners:edit", "buying-houses:delete",
]);

/** Queue results in the order resolveImpact will consume them. */
function queue(...results: Record<string, unknown>[][]) {
  for (const rows of results) execute.mockResolvedValueOnce({ rows });
}

beforeEach(() => execute.mockReset());

describe("resolveImpact", () => {
  it("returns an empty impact for an entity with no dependents", async () => {
    queue([{ id: 5, name: "Unused Term" }]); // target row
    // every dependent count query returns 0
    execute.mockResolvedValue({ rows: [{ n: 0 }] });

    const impact = await resolveImpact("payment_terms", 5, ALL);
    expect(impact.blockers).toEqual([]);
    expect(impact.cascades).toEqual([]);
    expect(impact.nullifies).toEqual([]);
    expect(impact.totals.deletes).toBe(0);
    expect(impact.canDeleteAll).toBe(true);
  });

  it("marks a node undeletable when the permission is missing", async () => {
    queue([{ id: 1, name: "Acme" }]);
    execute.mockImplementation(async (q: unknown) => {
      const text = String(q);
      if (text.includes("billings")) {
        return text.includes("count") ? { rows: [{ n: 1 }] } : { rows: [{ id: 12, invoiceCode: "CBILL-0012" }] };
      }
      return { rows: [{ n: 0 }] };
    });

    const impact = await resolveImpact("clients", 1, new Set(["clients:delete"]));
    expect(impact.canDeleteAll).toBe(false);
    expect(impact.missingPermissions).toContain("billings:edit");
  });

  it("produces a fingerprint that is order-independent", () => {
    const a = fingerprintOf([{ table: "billings", id: 2 }, { table: "clients", id: 1 }]);
    const b = fingerprintOf([{ table: "clients", id: 1 }, { table: "billings", id: 2 }]);
    expect(a).toBe(b);
  });

  it("produces a different fingerprint when the node set changes", () => {
    const a = fingerprintOf([{ table: "billings", id: 2 }]);
    const b = fingerprintOf([{ table: "billings", id: 2 }, { table: "billings", id: 3 }]);
    expect(a).not.toBe(b);
  });

  it("rejects an unregistered table", async () => {
    await expect(resolveImpact("nope", 1, ALL)).rejects.toThrow(/descriptor/i);
  });

  it("collectDeletableNodes flattens blockers depth-first, deepest first", () => {
    const impact = {
      blockers: [{
        table: "client_purchase_orders", id: 31, children: [
          { table: "partner_purchase_orders", id: 88, children: [] },
        ],
      }],
      cascades: [],
    } as unknown as Parameters<typeof collectDeletableNodes>[0];

    expect(collectDeletableNodes(impact)).toEqual([
      { table: "partner_purchase_orders", id: 88 },
      { table: "client_purchase_orders", id: 31 },
    ]);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

From `app/`: `pnpm exec vitest run lib/dependencies/resolve.test.ts`
Expected: FAIL — cannot resolve `./resolve`.

- [ ] **Step 5: Implement the resolver**

Create `app/lib/dependencies/resolve.ts`:

```ts
import { sql } from "drizzle-orm";
import { db, dependentsOf, isBlocking, type FkEdge } from "@workspace/db";
import { getDescriptor, hasDescriptor } from "./descriptors";
import { fingerprintOf } from "./fingerprint";
import {
  MAX_DEPTH, MAX_ROWS_PER_LEVEL, CASCADE_SAMPLE_SIZE,
  type Impact, type ImpactNode, type CascadeGroup, type NullifyGroup,
} from "./types";

type Row = Record<string, unknown>;

async function selectRows(table: string, column: string, value: unknown, columns: string[], limit: number): Promise<Row[]> {
  const list = sql.join(columns.map(c => sql.identifier(c)), sql`, `);
  const res = await db.execute(sql`
    select ${list} from ${sql.identifier(table)}
    where ${sql.identifier(column)} = ${value}
    order by ${sql.identifier("id")} limit ${limit}
  `);
  return (res.rows ?? []) as Row[];
}

async function countRows(table: string, column: string, value: unknown): Promise<number> {
  const res = await db.execute(sql`
    select count(*)::int as n from ${sql.identifier(table)}
    where ${sql.identifier(column)} = ${value}
  `);
  return Number(((res.rows ?? [])[0] as { n?: number } | undefined)?.n ?? 0);
}

/** Total rows destroyed when `table`/`id` is deleted, following cascade edges only. */
async function cascadeTotal(table: string, id: unknown, depth: number): Promise<number> {
  if (depth > MAX_DEPTH) return 0;
  let total = 1;
  for (const edge of dependentsOf.get(table) ?? []) {
    if (edge.onDelete !== "cascade") continue;
    const rows = await selectRows(edge.childTable, edge.childColumn, id, ["id"], MAX_ROWS_PER_LEVEL);
    const count = await countRows(edge.childTable, edge.childColumn, id);
    // Sampled sub-walk: exact for small sets, approximated by count for large ones.
    if (count <= rows.length) {
      for (const r of rows) total += await cascadeTotal(edge.childTable, r.id, depth + 1);
    } else {
      total += count;
    }
  }
  return total;
}

function toNode(edge: FkEdge, row: Row, permissions: Set<string>): ImpactNode {
  const d = getDescriptor(edge.childTable);
  const id = row.id as number | string;
  return {
    table: edge.childTable,
    id,
    label: d.labelWith(row),
    singular: d.singular,
    href: d.href ? d.href(id) : null,
    canDelete: permissions.has(d.deletePermission),
    requiredPermission: d.deletePermission,
    deleteEndpoint: d.deleteEndpoint ? d.deleteEndpoint(id) : null,
    children: [],
    truncated: false,
  };
}

async function resolveBlockers(table: string, id: unknown, permissions: Set<string>, depth: number): Promise<{ nodes: ImpactNode[]; truncated: boolean }> {
  if (depth >= MAX_DEPTH) return { nodes: [], truncated: true };
  const nodes: ImpactNode[] = [];
  let truncated = false;

  for (const edge of dependentsOf.get(table) ?? []) {
    if (!isBlocking(edge.onDelete)) continue;
    const d = getDescriptor(edge.childTable);
    const rows = await selectRows(edge.childTable, edge.childColumn, id, d.labelColumns, MAX_ROWS_PER_LEVEL + 1);
    if (rows.length > MAX_ROWS_PER_LEVEL) {
      truncated = true;
      rows.length = MAX_ROWS_PER_LEVEL;
    }
    for (const row of rows) {
      const node = toNode(edge, row, permissions);
      const child = await resolveBlockers(edge.childTable, node.id, permissions, depth + 1);
      node.children = child.nodes;
      node.truncated = child.truncated;
      if (child.truncated) truncated = true;
      nodes.push(node);
    }
  }
  return { nodes, truncated };
}

export async function resolveImpact(table: string, id: number | string, permissions: Set<string>): Promise<Impact> {
  if (!hasDescriptor(table)) throw new Error(`No dependency descriptor registered for table "${table}"`);
  const targetDesc = getDescriptor(table);

  const [targetRow] = await selectRows(table, "id", id, targetDesc.labelColumns, 1);
  if (!targetRow) throw new Error(`${targetDesc.singular} not found`);

  const { nodes: blockers, truncated } = await resolveBlockers(table, id, permissions, 0);

  const cascades: CascadeGroup[] = [];
  const nullifies: NullifyGroup[] = [];

  for (const edge of dependentsOf.get(table) ?? []) {
    if (edge.onDelete === "cascade") {
      const count = await countRows(edge.childTable, edge.childColumn, id);
      if (count === 0) continue;
      const d = getDescriptor(edge.childTable);
      const sampleRows = await selectRows(edge.childTable, edge.childColumn, id, d.labelColumns, CASCADE_SAMPLE_SIZE);
      let transitive = 0;
      for (const r of sampleRows) transitive += await cascadeTotal(edge.childTable, r.id, 1);
      const perRow = sampleRows.length > 0 ? transitive / sampleRows.length : 1;
      cascades.push({
        table: edge.childTable,
        label: d.plural,
        count: Math.round(count * perRow),
        sample: sampleRows.map(r => toNode(edge, r, permissions)),
        canDelete: permissions.has(d.deletePermission),
        requiredPermission: d.deletePermission,
      });
    } else if (edge.onDelete === "set null" || edge.onDelete === "set default") {
      const count = await countRows(edge.childTable, edge.childColumn, id);
      if (count === 0) continue;
      const d = getDescriptor(edge.childTable);
      nullifies.push({ table: edge.childTable, column: edge.childColumn, label: d.plural, count });
    }
  }

  const missing = new Set<string>();
  const walk = (ns: ImpactNode[]) => ns.forEach(n => {
    if (!n.canDelete) missing.add(n.requiredPermission);
    walk(n.children);
  });
  walk(blockers);
  for (const c of cascades) if (!c.canDelete) missing.add(c.requiredPermission);

  const blockerCount = (function count(ns: ImpactNode[]): number {
    return ns.reduce((s, n) => s + 1 + count(n.children), 0);
  })(blockers);

  const touchesFinancial =
    targetDesc.financial ||
    cascades.some(c => getDescriptor(c.table).financial) ||
    (function anyFinancial(ns: ImpactNode[]): boolean {
      return ns.some(n => getDescriptor(n.table).financial || anyFinancial(n.children));
    })(blockers);

  const nodeKeys = [
    { table, id },
    ...(function flatten(ns: ImpactNode[]): { table: string; id: number | string }[] {
      return ns.flatMap(n => [{ table: n.table, id: n.id }, ...flatten(n.children)]);
    })(blockers),
    ...cascades.map(c => ({ table: c.table, id: `count:${c.count}` })),
  ];

  const blockedReason = truncated
    ? "This entity has more dependents than can be safely reviewed at once. Delete some individually first."
    : missing.size > 0
      ? "You do not have permission to delete every affected record."
      : null;

  return {
    target: { table, id, label: targetDesc.labelWith(targetRow), singular: targetDesc.singular },
    blockers,
    cascades,
    nullifies,
    canDeleteAll: !truncated && missing.size === 0,
    blockedReason,
    missingPermissions: [...missing].sort(),
    totals: {
      deletes: blockerCount + cascades.reduce((s, c) => s + c.count, 0) + 1,
      nullifies: nullifies.reduce((s, n) => s + n.count, 0),
      touchesFinancial,
    },
    fingerprint: fingerprintOf(nodeKeys),
  };
}

/** Blocker nodes flattened deepest-first — the order they must be deleted in. */
export function collectDeletableNodes(impact: Pick<Impact, "blockers">): { table: string; id: number | string }[] {
  const out: { table: string; id: number | string }[] = [];
  const walk = (ns: ImpactNode[]) => {
    for (const n of ns) {
      walk(n.children);
      out.push({ table: n.table, id: n.id });
    }
  };
  walk(impact.blockers);
  return out;
}
```

- [ ] **Step 6: Run test to verify it passes**

From `app/`: `pnpm exec vitest run lib/dependencies/resolve.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 7: Commit**

```bash
git add app/lib/dependencies/types.ts app/lib/dependencies/fingerprint.ts app/lib/dependencies/resolve.ts app/lib/dependencies/resolve.test.ts
git commit -m "feat(dependencies): resolve impact trees with permission gating and fingerprinting"
```

---

### Task 4: GET /api/dependencies

**Files:**
- Create: `app/app/api/dependencies/route.ts`
- Create: `app/app/api/dependencies/route.test.ts`

**Interfaces:**
- Consumes: `resolveImpact` from `@/lib/dependencies/resolve`; `hasDescriptor` from `@/lib/dependencies/descriptors`; `getSession` from `@/lib/auth/session`; `getRolePermissions` from `@/lib/rbac/role-permissions`; `effectivePermissions` from `@/lib/rbac/can`.
- Produces: `GET /api/dependencies?table=<t>&id=<id>` returning `Impact` as JSON.

**Background:** This route needs the user's full permission *set*, not a single check, so it uses `getSession()` + `effectivePermissions()` directly rather than `requirePermission()`. It still enforces a guard: the caller must hold the target table's delete permission to even see the tree.

- [ ] **Step 1: Write the failing test**

Create `app/app/api/dependencies/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveImpact = vi.fn();

vi.mock("@/lib/dependencies/resolve", () => ({ resolveImpact: (...a: unknown[]) => resolveImpact(...a) }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn(async () => ({ sub: 1, name: "T", email: "t@x.com", role: "System Admin", isSystem: true })) }));
vi.mock("@/lib/rbac/role-permissions", () => ({ getRolePermissions: vi.fn(async () => []) }));

beforeEach(() => resolveImpact.mockReset());

async function get(qs: string) {
  const { GET } = await import("./route");
  return GET(new Request(`http://localhost/api/dependencies?${qs}`));
}

describe("GET /api/dependencies", () => {
  it("400s when table is missing", async () => {
    expect((await get("id=1")).status).toBe(400);
  });

  it("400s when id is not a positive integer", async () => {
    expect((await get("table=clients&id=abc")).status).toBe(400);
  });

  it("400s on an unregistered table", async () => {
    const res = await get("table=pg_catalog&id=1");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/unknown table/i);
  });

  it("returns the resolved impact", async () => {
    resolveImpact.mockResolvedValueOnce({ target: { table: "clients", id: 1, label: "Acme" }, blockers: [] });
    const res = await get("table=clients&id=1");
    expect(res.status).toBe(200);
    expect((await res.json()).target.label).toBe("Acme");
  });

  it("404s when the entity does not exist", async () => {
    resolveImpact.mockRejectedValueOnce(new Error("Client not found"));
    expect((await get("table=clients&id=999")).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

From `app/`: `pnpm exec vitest run app/api/dependencies/route.test.ts`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Implement the route**

Create `app/app/api/dependencies/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getRolePermissions } from "@/lib/rbac/role-permissions";
import { effectivePermissions } from "@/lib/rbac/can";
import { getDescriptor, hasDescriptor } from "@/lib/dependencies/descriptors";
import { resolveImpact } from "@/lib/dependencies/resolve";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const url = new URL(req.url);
  const table = url.searchParams.get("table");
  const rawId = url.searchParams.get("id");
  if (!table || !rawId) return NextResponse.json({ error: "table and id are required" }, { status: 400 });

  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "id must be a positive integer" }, { status: 400 });

  if (!hasDescriptor(table)) return NextResponse.json({ error: `Unknown table "${table}"` }, { status: 400 });

  const rolePerms = await getRolePermissions(user.role);
  const permissions = effectivePermissions({ role: user.role, isSystem: user.isSystem }, rolePerms);

  if (!permissions.has(getDescriptor(table).deletePermission))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    return NextResponse.json(await resolveImpact(table, id, permissions));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to resolve dependencies";
    if (/not found/i.test(message)) return NextResponse.json({ error: message }, { status: 404 });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

From `app/`: `pnpm exec vitest run app/api/dependencies/route.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add app/app/api/dependencies/route.ts app/app/api/dependencies/route.test.ts
git commit -m "feat(api): add GET /api/dependencies impact endpoint"
```

---

### Task 5: POST /api/dependencies/delete

**Files:**
- Create: `app/app/api/dependencies/delete/route.ts`
- Create: `app/app/api/dependencies/delete/route.test.ts`

**Interfaces:**
- Consumes: `resolveImpact`, `collectDeletableNodes` from `@/lib/dependencies/resolve`; `db` from `@workspace/db`.
- Produces: `POST /api/dependencies/delete` accepting `{ table, id, fingerprint }`.

**Background:** The server **re-resolves** rather than trusting the client's tree. `db.transaction(async (tx) => …)` is the Drizzle transaction API; a thrown error inside rolls everything back. Deletion is bottom-up (`collectDeletableNodes` returns deepest-first); Postgres handles cascade and set-null edges natively, so only blocker rows plus the target are deleted explicitly.

- [ ] **Step 1: Write the failing test**

Create `app/app/api/dependencies/delete/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveImpact = vi.fn();
const txExecute = vi.fn();
const transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb({ execute: txExecute }));

vi.mock("@/lib/dependencies/resolve", async () => {
  const actual = await vi.importActual<typeof import("@/lib/dependencies/resolve")>("@/lib/dependencies/resolve");
  return { ...actual, resolveImpact: (...a: unknown[]) => resolveImpact(...a) };
});
vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<typeof import("@workspace/db")>("@workspace/db");
  return { ...actual, db: { transaction: (cb: (tx: unknown) => Promise<unknown>) => transaction(cb) } };
});
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn(async () => ({ sub: 1, name: "T", email: "t@x.com", role: "System Admin", isSystem: true })) }));
vi.mock("@/lib/rbac/role-permissions", () => ({ getRolePermissions: vi.fn(async () => []) }));

beforeEach(() => { resolveImpact.mockReset(); txExecute.mockReset(); transaction.mockClear(); });

async function post(body: unknown) {
  const { POST } = await import("./route");
  return POST(new Request("http://localhost/api/dependencies/delete", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
}

const impact = (over: Record<string, unknown> = {}) => ({
  target: { table: "clients", id: 1, label: "Acme", singular: "Client" },
  blockers: [], cascades: [], nullifies: [],
  canDeleteAll: true, blockedReason: null, missingPermissions: [],
  totals: { deletes: 1, nullifies: 0, touchesFinancial: false },
  fingerprint: "abc123",
  ...over,
});

describe("POST /api/dependencies/delete", () => {
  it("400s on a malformed body", async () => {
    expect((await post({ table: "clients" })).status).toBe(400);
  });

  it("400s on an unregistered table", async () => {
    expect((await post({ table: "pg_catalog", id: 1, fingerprint: "x" })).status).toBe(400);
  });

  it("409s when the fingerprint no longer matches", async () => {
    resolveImpact.mockResolvedValueOnce(impact({ fingerprint: "changed" }));
    const res = await post({ table: "clients", id: 1, fingerprint: "abc123" });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/changed/i);
    expect(body.impact.fingerprint).toBe("changed");
  });

  it("403s when a permission is missing, naming it", async () => {
    resolveImpact.mockResolvedValueOnce(impact({ canDeleteAll: false, missingPermissions: ["billings:edit"] }));
    const res = await post({ table: "clients", id: 1, fingerprint: "abc123" });
    expect(res.status).toBe(403);
    expect((await res.json()).missingPermissions).toEqual(["billings:edit"]);
  });

  it("deletes bottom-up inside one transaction", async () => {
    resolveImpact.mockResolvedValueOnce(impact({
      blockers: [{
        table: "client_purchase_orders", id: 31, label: "CPO-0031", singular: "Client PO",
        href: null, canDelete: true, requiredPermission: "purchase-orders:edit",
        deleteEndpoint: null, truncated: false,
        children: [{
          table: "partner_purchase_orders", id: 88, label: "PPO-0088", singular: "Partner PO",
          href: null, canDelete: true, requiredPermission: "purchase-orders:edit",
          deleteEndpoint: null, truncated: false, children: [],
        }],
      }],
    }));
    const res = await post({ table: "clients", id: 1, fingerprint: "abc123" });
    expect(res.status).toBe(200);
    expect(transaction).toHaveBeenCalledOnce();
    // 2 blockers deepest-first + the target itself
    expect(txExecute).toHaveBeenCalledTimes(3);
  });

  it("rolls back and 500s when a delete fails", async () => {
    resolveImpact.mockResolvedValueOnce(impact());
    txExecute.mockRejectedValueOnce(new Error("deadlock detected"));
    const res = await post({ table: "clients", id: 1, fingerprint: "abc123" });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/deadlock/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

From `app/`: `pnpm exec vitest run app/api/dependencies/delete/route.test.ts`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Implement the route**

Create `app/app/api/dependencies/delete/route.ts`:

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { getSession } from "@/lib/auth/session";
import { getRolePermissions } from "@/lib/rbac/role-permissions";
import { effectivePermissions } from "@/lib/rbac/can";
import { getDescriptor, hasDescriptor } from "@/lib/dependencies/descriptors";
import { resolveImpact, collectDeletableNodes } from "@/lib/dependencies/resolve";

export const runtime = "nodejs";

const Body = z.object({
  table: z.string().min(1),
  id: z.number().int().positive(),
  fingerprint: z.string().min(1),
});

export async function POST(req: Request): Promise<Response> {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  let raw: unknown;
  try { raw = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const { table, id, fingerprint } = parsed.data;

  if (!hasDescriptor(table)) return NextResponse.json({ error: `Unknown table "${table}"` }, { status: 400 });

  const rolePerms = await getRolePermissions(user.role);
  const permissions = effectivePermissions({ role: user.role, isSystem: user.isSystem }, rolePerms);
  if (!permissions.has(getDescriptor(table).deletePermission))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Never trust the client's tree — re-resolve against current state.
  let impact;
  try {
    impact = await resolveImpact(table, id, permissions);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to resolve dependencies";
    if (/not found/i.test(message)) return NextResponse.json({ error: message }, { status: 404 });
    return NextResponse.json({ error: message }, { status: 500 });
  }

  if (impact.fingerprint !== fingerprint)
    return NextResponse.json({
      error: "This changed while you were reviewing it. Review the updated list before deleting.",
      impact,
    }, { status: 409 });

  if (!impact.canDeleteAll)
    return NextResponse.json({
      error: impact.blockedReason ?? "Forbidden",
      missingPermissions: impact.missingPermissions,
    }, { status: 403 });

  const targets = [...collectDeletableNodes(impact), { table, id }];

  try {
    await db.transaction(async (tx) => {
      for (const t of targets) {
        await tx.execute(sql`delete from ${sql.identifier(t.table)} where ${sql.identifier("id")} = ${t.id}`);
      }
    });
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    if ((e.code ?? e.cause?.code) === "23503")
      return NextResponse.json({ error: "A record outside the reviewed list still depends on this. Reopen and try again." }, { status: 409 });
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to delete" }, { status: 500 });
  }

  const byTable = new Map<string, number>();
  for (const t of targets) byTable.set(t.table, (byTable.get(t.table) ?? 0) + 1);

  return NextResponse.json({ deleted: [...byTable].map(([t, count]) => ({ table: t, count })) });
}
```

- [ ] **Step 4: Run test to verify it passes**

From `app/`: `pnpm exec vitest run app/api/dependencies/delete/route.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add app/app/api/dependencies/delete/route.ts app/app/api/dependencies/delete/route.test.ts
git commit -m "feat(api): add transactional cascade delete endpoint with concurrency guard"
```

---

### Task 6: OpenAPI contract + codegen

**Files:**
- Modify: `lib/api-spec/openapi.yaml`

**Interfaces:**
- Produces: generated hooks `useGetDependencies`, `useDeleteDependencies` and their query-key helpers in `@workspace/api-client-react`; matching zod schemas + TS types in `@workspace/api-zod`.

**Background:** Read the existing `openapi.yaml` first and match its conventions exactly — component naming, `operationId` style, error response shapes. The generated output is consumed in Tasks 8–9, so `operationId` values determine the hook names.

- [ ] **Step 1: Read the existing spec conventions**

```bash
grep -n "operationId\|^  /" lib/api-spec/openapi.yaml | head -40
```

Note how paths, `operationId`s, and shared error components are named.

- [ ] **Step 2: Add the two paths**

Add to the `paths:` section of `lib/api-spec/openapi.yaml`, matching the surrounding indentation and error-response style:

```yaml
  /dependencies:
    get:
      operationId: getDependencies
      summary: Resolve the deletion impact tree for an entity
      parameters:
        - name: table
          in: query
          required: true
          schema: { type: string }
        - name: id
          in: query
          required: true
          schema: { type: integer, format: int32 }
      responses:
        "200":
          description: Impact tree
          content:
            application/json:
              schema: { $ref: "#/components/schemas/Impact" }
  /dependencies/delete:
    post:
      operationId: deleteDependencies
      summary: Delete an entity and all reviewed dependents in one transaction
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [table, id, fingerprint]
              properties:
                table: { type: string }
                id: { type: integer, format: int32 }
                fingerprint: { type: string }
      responses:
        "200":
          description: Deleted
          content:
            application/json:
              schema:
                type: object
                required: [deleted]
                properties:
                  deleted:
                    type: array
                    items:
                      type: object
                      required: [table, count]
                      properties:
                        table: { type: string }
                        count: { type: integer, format: int32 }
```

- [ ] **Step 3: Add the schema components**

Add to `components.schemas:` in `lib/api-spec/openapi.yaml`:

```yaml
    ImpactNode:
      type: object
      required: [table, id, label, singular, canDelete, requiredPermission, children, truncated]
      properties:
        table: { type: string }
        id: { type: integer, format: int32 }
        label: { type: string }
        singular: { type: string }
        href: { type: string, nullable: true }
        canDelete: { type: boolean }
        requiredPermission: { type: string }
        deleteEndpoint: { type: string, nullable: true }
        truncated: { type: boolean }
        children:
          type: array
          items: { $ref: "#/components/schemas/ImpactNode" }
    CascadeGroup:
      type: object
      required: [table, label, count, sample, canDelete, requiredPermission]
      properties:
        table: { type: string }
        label: { type: string }
        count: { type: integer, format: int32 }
        canDelete: { type: boolean }
        requiredPermission: { type: string }
        sample:
          type: array
          items: { $ref: "#/components/schemas/ImpactNode" }
    NullifyGroup:
      type: object
      required: [table, column, label, count]
      properties:
        table: { type: string }
        column: { type: string }
        label: { type: string }
        count: { type: integer, format: int32 }
    Impact:
      type: object
      required: [target, blockers, cascades, nullifies, canDeleteAll, missingPermissions, totals, fingerprint]
      properties:
        target:
          type: object
          required: [table, id, label, singular]
          properties:
            table: { type: string }
            id: { type: integer, format: int32 }
            label: { type: string }
            singular: { type: string }
        blockers:
          type: array
          items: { $ref: "#/components/schemas/ImpactNode" }
        cascades:
          type: array
          items: { $ref: "#/components/schemas/CascadeGroup" }
        nullifies:
          type: array
          items: { $ref: "#/components/schemas/NullifyGroup" }
        canDeleteAll: { type: boolean }
        blockedReason: { type: string, nullable: true }
        missingPermissions:
          type: array
          items: { type: string }
        totals:
          type: object
          required: [deletes, nullifies, touchesFinancial]
          properties:
            deletes: { type: integer, format: int32 }
            nullifies: { type: integer, format: int32 }
            touchesFinancial: { type: boolean }
        fingerprint: { type: string }
```

- [ ] **Step 4: Run codegen**

```bash
pnpm --filter @workspace/api-spec codegen
```

Expected: regenerates `lib/api-client-react/src/generated` and `lib/api-zod/src/generated`, then runs `typecheck:libs` clean.

**If `ImpactNode`'s self-reference breaks orval's zod output** (recursive schemas are a known weak spot), stop and fall back: flatten `children` to depth-1 in the OpenAPI schema and type the recursive shape by hand in `app/lib/dependencies/types.ts`, which the UI already imports. Do not hand-edit generated files.

- [ ] **Step 5: Verify the generated hooks exist**

```bash
grep -rn "useGetDependencies\|useDeleteDependencies" lib/api-client-react/src/generated | head
```

Expected: both hooks present.

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm typecheck
git add lib/api-spec/openapi.yaml lib/api-client-react/src/generated lib/api-zod/src/generated
git commit -m "feat(api-spec): add dependencies endpoints and regenerate client"
```

---

### Task 7: DeleteImpactDialog component

**Files:**
- Create: `app/components/ui/delete-impact-dialog.tsx`
- Create: `app/components/ui/delete-impact-dialog.test.tsx`

**Interfaces:**
- Consumes: `Impact`, `ImpactNode` from `@/lib/dependencies/types`; `AlertDialog*` from `@/components/ui/alert-dialog`; `Button` from `@/components/ui/button`.
- Produces:

```ts
export type DeleteImpactDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  impact: Impact | null;
  isLoading: boolean;
  isDeleting: boolean;
  onDeleteNode: (node: { table: string; id: number | string; deleteEndpoint: string | null }) => Promise<void>;
  onDeleteAll: () => Promise<void>;
  onDeleteTarget: () => Promise<void>;
};
export function DeleteImpactDialog(props: DeleteImpactDialogProps): JSX.Element;
export function isEmptyImpact(impact: Impact | null): boolean;
```

**Background:** `vitest.config.ts` sets `environment: "node"`, so component tests must opt into a DOM. Add `// @vitest-environment jsdom` as the **first line** of the test file. Check whether `jsdom` and `@testing-library/react` are installed (`app/components/rbac/GatedTabs.test.tsx` is the existing precedent — read it first and match its setup). If they are missing, install them as devDependencies in `app/`:

```bash
pnpm --filter @workspace/web add -D jsdom @testing-library/react @testing-library/user-event
```

- [ ] **Step 1: Read the existing component-test precedent**

```bash
sed -n '1,30p' app/components/rbac/GatedTabs.test.tsx
```

Match its environment directive, imports, and render helper style.

- [ ] **Step 2: Write the failing test**

Create `app/components/ui/delete-impact-dialog.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DeleteImpactDialog, isEmptyImpact } from "./delete-impact-dialog";
import type { Impact } from "@/lib/dependencies/types";

const base: Impact = {
  target: { table: "clients", id: 1, label: "Acme Corp", singular: "Client" },
  blockers: [], cascades: [], nullifies: [],
  canDeleteAll: true, blockedReason: null, missingPermissions: [],
  totals: { deletes: 1, nullifies: 0, touchesFinancial: false },
  fingerprint: "fp1",
};

const noop = async () => {};
const props = {
  open: true, onOpenChange: () => {}, isLoading: false, isDeleting: false,
  onDeleteNode: noop, onDeleteAll: noop, onDeleteTarget: noop,
};

describe("isEmptyImpact", () => {
  it("is true when nothing is affected", () => {
    expect(isEmptyImpact(base)).toBe(true);
  });

  it("is false when a blocker exists", () => {
    expect(isEmptyImpact({ ...base, blockers: [{
      table: "billings", id: 12, label: "CBILL-0012", singular: "Client Bill",
      href: null, canDelete: true, requiredPermission: "billings:edit",
      deleteEndpoint: null, children: [], truncated: false,
    }] })).toBe(false);
  });

  it("is false when a cascade exists", () => {
    expect(isEmptyImpact({ ...base, cascades: [{
      table: "client_events", label: "Client Events", count: 8, sample: [],
      canDelete: true, requiredPermission: "clients:edit",
    }] })).toBe(false);
  });
});

describe("DeleteImpactDialog", () => {
  it("renders blockers with their labels", () => {
    render(<DeleteImpactDialog {...props} impact={{ ...base, blockers: [{
      table: "billings", id: 12, label: "CBILL-0012", singular: "Client Bill",
      href: null, canDelete: true, requiredPermission: "billings:edit",
      deleteEndpoint: "/api/billings/12", children: [], truncated: false,
    }] }} />);
    expect(screen.getByText("CBILL-0012")).toBeDefined();
    expect(screen.getByText(/must be deleted first/i)).toBeDefined();
  });

  it("shows the required permission on a locked row and disables Delete All", () => {
    render(<DeleteImpactDialog {...props} impact={{
      ...base, canDeleteAll: false, missingPermissions: ["billings:edit"],
      blockedReason: "You do not have permission to delete every affected record.",
      blockers: [{
        table: "billings", id: 12, label: "CBILL-0012", singular: "Client Bill",
        href: null, canDelete: false, requiredPermission: "billings:edit",
        deleteEndpoint: "/api/billings/12", children: [], truncated: false,
      }],
    }} />);
    expect(screen.getByText(/billings:edit/)).toBeDefined();
    expect(screen.getByRole("button", { name: /delete all/i }).hasAttribute("disabled")).toBe(true);
  });

  it("renders cascade counts and nullify lines", () => {
    render(<DeleteImpactDialog {...props} impact={{
      ...base,
      cascades: [{ table: "billing_records", label: "Billing Records", count: 142, sample: [], canDelete: true, requiredPermission: "billings:edit" }],
      nullifies: [{ table: "billing_records", column: "client_id", label: "Billing Records", count: 3 }],
    }} />);
    expect(screen.getByText(/142/)).toBeDefined();
    expect(screen.getByText(/will be unlinked/i)).toBeDefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

From `app/`: `pnpm exec vitest run components/ui/delete-impact-dialog.test.tsx`
Expected: FAIL — cannot resolve `./delete-impact-dialog`.

- [ ] **Step 4: Implement the component**

Create `app/components/ui/delete-impact-dialog.tsx`. Two screens are held in local state: `"review"` and `"confirm"`. Row-level confirmation is also local state keyed by `table:id`.

```tsx
"use client";

import { useState } from "react";
import { AlertTriangle, Flame, Link2, Lock, ExternalLink } from "lucide-react";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { Impact, ImpactNode } from "@/lib/dependencies/types";

export function isEmptyImpact(impact: Impact | null): boolean {
  if (!impact) return true;
  return impact.blockers.length === 0 && impact.cascades.length === 0 && impact.nullifies.length === 0;
}

export type DeleteImpactDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  impact: Impact | null;
  isLoading: boolean;
  isDeleting: boolean;
  onDeleteNode: (node: { table: string; id: number | string; deleteEndpoint: string | null }) => Promise<void>;
  onDeleteAll: () => Promise<void>;
  onDeleteTarget: () => Promise<void>;
};

function NodeRow({ node, depth, pendingKey, setPendingKey, onDeleteNode, isDeleting }: {
  node: ImpactNode; depth: number;
  pendingKey: string | null; setPendingKey: (k: string | null) => void;
  onDeleteNode: DeleteImpactDialogProps["onDeleteNode"]; isDeleting: boolean;
}) {
  const key = `${node.table}:${node.id}`;
  const isPending = pendingKey === key;
  return (
    <>
      <div
        className="flex items-center gap-2 py-1.5 text-sm"
        style={{ paddingLeft: `${depth * 16}px` }}
      >
        <span className="text-muted-foreground text-xs shrink-0">{node.singular}</span>
        <span className="font-medium truncate">{node.label}</span>
        {node.href && (
          <a href={node.href} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground shrink-0">
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
        <div className="ml-auto shrink-0">
          {!node.canDelete ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Lock className="h-3 w-3" /> needs {node.requiredPermission}
            </span>
          ) : isPending ? (
            <span className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Delete this {node.singular}?</span>
              <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setPendingKey(null)}>Cancel</Button>
              <Button
                size="sm" variant="destructive" className="h-6 text-xs" disabled={isDeleting}
                onClick={async () => { await onDeleteNode(node); setPendingKey(null); }}
              >Delete</Button>
            </span>
          ) : node.deleteEndpoint ? (
            <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setPendingKey(key)}>Delete</Button>
          ) : null}
        </div>
      </div>
      {node.children.map(c => (
        <NodeRow
          key={`${c.table}:${c.id}`} node={c} depth={depth + 1}
          pendingKey={pendingKey} setPendingKey={setPendingKey}
          onDeleteNode={onDeleteNode} isDeleting={isDeleting}
        />
      ))}
    </>
  );
}

export function DeleteImpactDialog({
  open, onOpenChange, impact, isLoading, isDeleting,
  onDeleteNode, onDeleteAll, onDeleteTarget,
}: DeleteImpactDialogProps) {
  const [screen, setScreen] = useState<"review" | "confirm">("review");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  const hasBlockers = (impact?.blockers.length ?? 0) > 0;
  const needsTyped = impact?.totals.touchesFinancial ?? false;
  const typedOk = !needsTyped || typed.trim() === impact?.target.label;

  return (
    <AlertDialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setScreen("review"); setTyped(""); setPendingKey(null); } }}>
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {impact?.target.singular ?? "item"} — {impact?.target.label ?? ""}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {screen === "review"
              ? "Review everything this will affect before continuing."
              : `This permanently deletes ${impact?.totals.deletes ?? 0} records. This cannot be undone.`}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Checking dependencies…</p>
        ) : !impact ? null : screen === "review" ? (
          <div className="max-h-[50vh] space-y-5 overflow-y-auto">
            {hasBlockers && (
              <section>
                <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <AlertTriangle className="h-3.5 w-3.5" /> Must be deleted first
                </h3>
                {impact.blockers.map(n => (
                  <NodeRow
                    key={`${n.table}:${n.id}`} node={n} depth={0}
                    pendingKey={pendingKey} setPendingKey={setPendingKey}
                    onDeleteNode={onDeleteNode} isDeleting={isDeleting}
                  />
                ))}
              </section>
            )}

            {impact.cascades.length > 0 && (
              <section>
                <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Flame className="h-3.5 w-3.5" /> Will also be permanently deleted
                </h3>
                <ul className="space-y-1 text-sm">
                  {impact.cascades.map(c => (
                    <li key={c.table} className="flex items-center gap-2">
                      <span className="font-medium">{c.count}</span>
                      <span>{c.label}</span>
                      {!c.canDelete && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Lock className="h-3 w-3" /> needs {c.requiredPermission}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {impact.nullifies.length > 0 && (
              <section>
                <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Link2 className="h-3.5 w-3.5" /> Will be unlinked, not deleted
                </h3>
                <ul className="space-y-1 text-sm">
                  {impact.nullifies.map(n => (
                    <li key={`${n.table}.${n.column}`}>
                      {n.count} {n.label} will lose their {n.column.replace(/_id$/, "").replace(/_/g, " ")}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {impact.blockedReason && (
              <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">{impact.blockedReason}</p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <ul className="space-y-1 text-sm">
              {impact.cascades.map(c => <li key={c.table}>{c.count} {c.label}</li>)}
              {impact.blockers.length > 0 && <li>{impact.blockers.length} direct dependents (and their children)</li>}
              <li>1 {impact.target.singular} — {impact.target.label}</li>
            </ul>
            {needsTyped && (
              <label className="block space-y-1 text-sm">
                <span className="text-muted-foreground">
                  This includes financial records. Type <strong>{impact.target.label}</strong> to confirm.
                </span>
                <input
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                  value={typed} onChange={e => setTyped(e.target.value)}
                />
              </label>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          {screen === "confirm" && (
            <Button variant="ghost" size="sm" onClick={() => setScreen("review")}>Back</Button>
          )}
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          {screen === "review" ? (
            <Button
              variant="destructive" size="sm"
              disabled={!impact?.canDeleteAll || isDeleting || isLoading}
              onClick={() => setScreen("confirm")}
            >
              {hasBlockers
                ? `Delete All — ${impact?.totals.deletes ?? 0} records`
                : `Delete ${impact?.target.singular ?? ""}`}
            </Button>
          ) : (
            <Button
              variant="destructive" size="sm" disabled={!typedOk || isDeleting}
              onClick={async () => { await (hasBlockers ? onDeleteAll() : onDeleteTarget()); }}
            >
              {isDeleting ? "Deleting…" : "Delete Everything"}
            </Button>
          )}
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

From `app/`: `pnpm exec vitest run components/ui/delete-impact-dialog.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add app/components/ui/delete-impact-dialog.tsx app/components/ui/delete-impact-dialog.test.tsx
git commit -m "feat(ui): add delete impact dialog with inline row confirm and typed bulk confirm"
```

---

### Task 8: useDeleteWithDependencies hook

**Files:**
- Create: `app/hooks/use-delete-with-dependencies.ts`

**Interfaces:**
- Consumes: `Impact` from `@/lib/dependencies/types`; `useQueryClient` from `@tanstack/react-query`; `toast` from `@/hooks/use-toast`.
- Produces:

```ts
export function useDeleteWithDependencies(opts: {
  table: string;
  onDeleted?: () => void;
  invalidateKeys?: readonly unknown[][];
}): {
  start: (id: number | string) => void;
  dialogProps: DeleteImpactDialogProps;
  impact: Impact | null;
};
```

**Background:** The hook fetches the impact when `start(id)` is called. When the impact is empty, `DeleteImpactDialog` hides all three sections on its own and shows just the header plus the primary `Delete <Singular>` button — that *is* the plain-confirmation path, so the hook needs no separate branch for it. Per-row deletes call the node's own `deleteEndpoint`; bulk deletes call `POST /api/dependencies/delete`.

- [ ] **Step 1: Implement the hook**

Create `app/hooks/use-delete-with-dependencies.ts`:

```ts
"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import type { Impact } from "@/lib/dependencies/types";

type Options = {
  table: string;
  onDeleted?: () => void;
  invalidateKeys?: readonly unknown[][];
};

export function useDeleteWithDependencies({ table, onDeleted, invalidateKeys = [] }: Options) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState<number | string | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const invalidateAll = useCallback(async () => {
    await Promise.all(invalidateKeys.map(k => qc.invalidateQueries({ queryKey: k })));
  }, [qc, invalidateKeys]);

  const fetchImpact = useCallback(async (id: number | string) => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/dependencies?table=${encodeURIComponent(table)}&id=${id}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to check dependencies");
      setImpact(body as Impact);
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Failed to check dependencies", variant: "destructive" });
      setOpen(false);
    } finally {
      setIsLoading(false);
    }
  }, [table]);

  const start = useCallback((id: number | string) => {
    setTargetId(id);
    setImpact(null);
    setOpen(true);
    void fetchImpact(id);
  }, [fetchImpact]);

  const finish = useCallback(async (label: string) => {
    setOpen(false);
    await invalidateAll();
    toast({ title: label });
    onDeleted?.();
  }, [invalidateAll, onDeleted]);

  const onDeleteNode = useCallback(async (node: { table: string; id: number | string; deleteEndpoint: string | null }) => {
    if (!node.deleteEndpoint) {
      toast({ title: "This record can't be deleted on its own — use Delete All.", variant: "destructive" });
      return;
    }
    setIsDeleting(true);
    try {
      const res = await fetch(node.deleteEndpoint, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to delete");
      }
      if (targetId != null) await fetchImpact(targetId);   // re-resolve; tree shrinks
      await invalidateAll();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Failed to delete", variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  }, [targetId, fetchImpact, invalidateAll]);

  const runBulk = useCallback(async () => {
    if (!impact || targetId == null) return;
    setIsDeleting(true);
    try {
      const res = await fetch("/api/dependencies/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ table, id: targetId, fingerprint: impact.fingerprint }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409 && body.impact) {
        setImpact(body.impact as Impact);
        toast({ title: body.error ?? "This changed while you were reviewing it.", variant: "destructive" });
        return;
      }
      if (!res.ok) throw new Error(body.error ?? "Failed to delete");
      await finish(`${impact.target.singular} deleted`);
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Failed to delete", variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  }, [impact, targetId, table, finish]);

  return {
    start,
    impact,
    dialogProps: {
      open,
      onOpenChange: setOpen,
      impact,
      isLoading,
      isDeleting,
      onDeleteNode,
      onDeleteAll: runBulk,
      onDeleteTarget: runBulk,
    },
  };
}
```

- [ ] **Step 2: Typecheck**

From repo root: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/hooks/use-delete-with-dependencies.ts
git commit -m "feat(hooks): add useDeleteWithDependencies as the single delete entry point"
```

---

### Task 9: Migrate the three top-level call sites

**Files:**
- Modify: `app/app/(dashboard)/buying-houses/page.tsx`
- Modify: `app/app/(dashboard)/clients/page.tsx`
- Modify: `app/app/(dashboard)/partners/page.tsx`

**Interfaces:**
- Consumes: `useDeleteWithDependencies` from `@/hooks/use-delete-with-dependencies`; `DeleteImpactDialog` from `@/components/ui/delete-impact-dialog`.

**Background:** These three pages currently use the orval-generated `useDeleteX` mutations, wired to a bare `onClick={() => deleteMutation.mutate({ id })}` with no confirmation at all (`buying-houses/page.tsx:122`). Replace the mutation with the hook; keep the same query-key invalidation the mutation's `onSuccess` performed.

- [ ] **Step 1: Migrate the buying houses page**

In `app/app/(dashboard)/buying-houses/page.tsx`:

Remove `useDeleteBuyingHouse` from the `@workspace/api-client-react` import and delete the `deleteMutation` block (currently lines 62–67). Add:

```tsx
import { useDeleteWithDependencies } from "@/hooks/use-delete-with-dependencies";
import { DeleteImpactDialog } from "@/components/ui/delete-impact-dialog";
```

```tsx
  const del = useDeleteWithDependencies({
    table: "buying_houses",
    invalidateKeys: [getListBuyingHousesQueryKey()],
  });
```

Change the row button (line 122) from `onClick={() => deleteMutation.mutate({ id: bh.id })}` to:

```tsx
onClick={() => del.start(bh.id)}
```

Render the dialog once, as the last child of the page's outer `<div className="space-y-6">`:

```tsx
      <DeleteImpactDialog {...del.dialogProps} />
```

- [ ] **Step 2: Verify in the browser**

```bash
pnpm --filter @workspace/web dev
```

Open `/buying-houses`, click delete on a buying house that has clients and billing records. Expected: the modal lists the blocking billing records (via the `no action` FK) and counts the clients that will be unlinked.

- [ ] **Step 3: Migrate the clients page**

In `app/app/(dashboard)/clients/page.tsx`, add the same two imports:

```tsx
import { useDeleteWithDependencies } from "@/hooks/use-delete-with-dependencies";
import { DeleteImpactDialog } from "@/components/ui/delete-impact-dialog";
```

Drop `useDeleteClient` from the `@workspace/api-client-react` import and delete its `deleteMutation` block, then add

```tsx
  const del = useDeleteWithDependencies({
    table: "clients",
    invalidateKeys: [getListClientsQueryKey()],
  });
```

point the row's delete button at `del.start(c.id)`, and render `<DeleteImpactDialog {...del.dialogProps} />` once at the end of the page.

- [ ] **Step 4: Migrate the partners page**

In `app/app/(dashboard)/partners/page.tsx`, add the same two imports:

```tsx
import { useDeleteWithDependencies } from "@/hooks/use-delete-with-dependencies";
import { DeleteImpactDialog } from "@/components/ui/delete-impact-dialog";
```

Drop `useDeletePartner` from the `@workspace/api-client-react` import and delete its `deleteMutation` block, then add

```tsx
  const del = useDeleteWithDependencies({
    table: "partners",
    invalidateKeys: [getListPartnersQueryKey()],
  });
```

point the row's delete button at `del.start(p.id)`, and render `<DeleteImpactDialog {...del.dialogProps} />` once at the end of the page.

- [ ] **Step 5: Typecheck and run the full suite**

From repo root: `pnpm typecheck`
From `app/`: `pnpm test`
Expected: both clean; existing tests unaffected.

- [ ] **Step 6: Commit**

```bash
git add "app/app/(dashboard)/buying-houses/page.tsx" "app/app/(dashboard)/clients/page.tsx" "app/app/(dashboard)/partners/page.tsx"
git commit -m "feat(entities): route buying house, client, and partner deletes through the impact dialog"
```

---

### Task 10: Generalize the FK safety net across remaining routes

**Files:**
- Create: `app/lib/dependencies/fk-error.ts`
- Modify: `app/app/api/buying-houses/[id]/route.ts:80-84`
- Modify: the 13 other `DELETE` handlers listed below

**Interfaces:**
- Produces: `fkViolationResponse(err: unknown): Response | null` — returns a `409` response when the error is a Postgres `23503`, otherwise `null`.

**Background:** Right now only `buying-houses` maps `23503` to a readable message; every other route leaks a raw 500. Even with the modal in front, a race can still produce an FK violation, so each route needs the mapping. Extract it once and apply it uniformly.

The 14 handlers to update:
`billings/[id]`, `buying-houses/[id]`, `client-purchase-orders/[id]`, `clients/[id]`, `clients/[id]/events/[eventId]`, `cost-models/[id]`, `cost-resources/[id]`, `partner-bills/[id]`, `partner-payments/[id]`, `partner-purchase-orders/[id]`, `partners/[id]`, `partners/[id]/billing-records/[recordId]`, `payment-terms/[id]`, `payments/[id]`.

(`partners/[id]/clients/[clientId]`, `roles/[name]`, and `users/[email]` are excluded — join-table and identity deletes with their own semantics.)

- [ ] **Step 1: Write the failing test**

Create `app/lib/dependencies/fk-error.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fkViolationResponse } from "./fk-error";

describe("fkViolationResponse", () => {
  it("returns null for unrelated errors", () => {
    expect(fkViolationResponse(new Error("boom"))).toBeNull();
  });

  it("maps a top-level 23503 to a 409", async () => {
    const res = fkViolationResponse(Object.assign(new Error("fk"), { code: "23503" }));
    expect(res?.status).toBe(409);
    expect((await res!.json()).error).toMatch(/still depends on/i);
  });

  it("maps a nested cause 23503 to a 409", () => {
    const res = fkViolationResponse(Object.assign(new Error("fk"), { cause: { code: "23503" } }));
    expect(res?.status).toBe(409);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

From `app/`: `pnpm exec vitest run lib/dependencies/fk-error.test.ts`
Expected: FAIL — cannot resolve `./fk-error`.

- [ ] **Step 3: Implement the helper**

Create `app/lib/dependencies/fk-error.ts`:

```ts
import { NextResponse } from "next/server";

/**
 * Maps a Postgres foreign-key violation (23503) to a readable 409.
 * Returns null when the error is something else, so callers can rethrow.
 */
export function fkViolationResponse(err: unknown): Response | null {
  const e = err as { code?: string; cause?: { code?: string } };
  if ((e?.code ?? e?.cause?.code) !== "23503") return null;
  return NextResponse.json(
    { error: "Another record still depends on this. Open the delete dialog to review and remove them first." },
    { status: 409 },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

From `app/`: `pnpm exec vitest run lib/dependencies/fk-error.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Apply to the buying houses route**

In `app/app/api/buying-houses/[id]/route.ts`, replace the `catch` block (lines 80–84) with:

```ts
  } catch (err: unknown) {
    const fk = fkViolationResponse(err);
    if (fk) return fk;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to delete" }, { status: 500 });
  }
```

and add the import:

```ts
import { fkViolationResponse } from "@/lib/dependencies/fk-error";
```

- [ ] **Step 6: Apply to the remaining 13 handlers**

For each of the 13 other files, wrap the `db.delete(...)` call in the `DELETE` handler in `try`/`catch` using the exact same block as Step 5. Most currently have no `try`/`catch` at all — e.g. `payments/[id]/route.ts:63-65` becomes:

```ts
  try {
    const [row] = await db.delete(paymentsTable).where(eq(paymentsTable.id, p.data.id)).returning();
    if (!row) return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (err: unknown) {
    const fk = fkViolationResponse(err);
    if (fk) return fk;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to delete" }, { status: 500 });
  }
```

Do not change any permission guard, status code, or response shape beyond adding this catch.

- [ ] **Step 7: Typecheck and run the full suite**

From repo root: `pnpm typecheck`
From `app/`: `pnpm test`
Expected: both clean.

- [ ] **Step 8: Commit**

```bash
git add app/lib/dependencies/fk-error.ts app/lib/dependencies/fk-error.test.ts app/app/api
git commit -m "feat(api): map foreign-key violations to readable 409s across all delete routes"
```

---

## Remaining call sites (follow-up, not in this plan)

After Task 10 the system is complete and the three highest-pain entities are migrated. These `confirm()` call sites still need migrating and can be done incrementally with the same three-line pattern from Task 9:

- `app/components/billings/ClientBillingSummaryTab.tsx:140` (`table: "billings"`)
- `app/components/billings/PartnerBillingTab.tsx` (`table: "partner_bills"`)
- `app/components/payments/ClientPaymentsTab.tsx` (`table: "payments"`)
- `app/components/payments/PartnerPaymentsTab.tsx` (`table: "partner_payments"`)
- `app/components/purchase-orders/PartnerPOTab.tsx` (`table: "partner_purchase_orders"`)
- `app/app/(dashboard)/cost/page.tsx` (`table: "cost_resources"`)
- `app/app/(dashboard)/settings/page.tsx` (`table: "payment_terms"` / `"cost_models"`)
