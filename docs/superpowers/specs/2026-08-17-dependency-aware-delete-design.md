# Dependency-Aware Delete — Design

**Date:** 2026-08-17
**Status:** Approved (design); pending implementation plan
**Scope:** A generic, schema-derived dependency system that replaces every blind delete in the app. When deleting any entity, the user sees a full impact tree (what blocks the delete, what will be silently cascade-deleted, what will be unlinked), can delete blockers one-by-one from inside the modal without navigating away, or delete the whole tree in one RBAC-gated transactional operation. Applies to all 17 `DELETE` routes. Does **not** change any FK policy in the schema, and does **not** introduce soft-delete/voiding.

## Context — current state

Monorepo data flow (each layer is the source of truth for the next):

`lib/db/src/schema/*` (Drizzle) → `lib/api-spec/openapi.yaml` (API contract) → orval generates `lib/api-zod` (zod + TS types) and `lib/api-client-react` (React Query hooks) → `app/app/api/*` (Next.js route handlers) → `app/app/(dashboard)/*` (App Router pages).

**How deletion works today:**

- 17 `DELETE` handlers exist under `app/app/api/**`. Each fires the delete and lets Postgres decide the outcome.
- Only `app/app/api/buying-houses/[id]/route.ts:82` catches the FK violation (`23503`) and maps it to a human message. Every other route surfaces a raw 500 with the driver's error text.
- The UI uses the browser's native `confirm()` (e.g. `app/components/billings/ClientBillingSummaryTab.tsx:140`), which has no room to render dependents even if they were known.
- The result: a user hits an opaque error, must guess which records block them, navigate to each module, delete them, and return. Cascade deletions — which destroy data without ever blocking — are entirely invisible.
- Precedent exists for the concept: the Purchase Orders design (2026-06-24, decision 9) already specifies "CPO delete blocked while linked PPOs exist." This design generalizes that behavior.

**FK policies already declared in the schema** (verified across `lib/db/src/schema/*`):

| Policy | Effect on delete | Examples |
|---|---|---|
| `restrict` | **Blocks** the delete | `billings→clients`, `client_purchase_orders→clients`, `partner_bills→partners`, `partner_purchase_orders→partners`, `partner_purchase_orders→client_purchase_orders`, `billing_lines→partners`, `billing_event_items→client_events` |
| `cascade` | **Silently destroys** children | `client_events→clients`, `partner_clients→clients`, `billing_records→partners`, `billing_lines→billings`, `billing_event_items→billing_lines`, `payment_billings→payments`, `partner_payments→partner_bills`, `partner_event_payouts→partners` |
| `set null` | Unlinks, destroys nothing | `clients→buying_houses`, `billing_records→clients`, `partner_bills→clients`, most `createdById` |
| *(unspecified)* | Postgres defaults to `no action` — **blocks** | `billing_records→buying_houses`, `billing_records→cost_models`, `dashboard_layouts→users`. This is the edge behind the one existing FK error message in the app: deleting a buying house is blocked by its billing records. |

Because `restrict` edges chain (deleting a **client** is blocked by its client POs, which are themselves blocked by their partner POs), the blocker structure is a recursive tree, not a flat list.

**Permission slugs are not derivable from table names.** Verified across all 17 handlers: only `buying-houses:delete`, `clients:delete`, and `partners:delete` follow the `<entity>:delete` convention. The rest reuse `:edit` (`billings:edit`, `payments:edit`, `purchase-orders:edit`, `cost:edit`, `clients:edit`, `partners:edit`) or a settings slug (`settings.catalogs:manage`, `settings.roles:manage`, `settings.users:manage`). Note `payments/[id]` DELETE gates on `payments:edit`. The descriptor registry records each table's actual delete permission verbatim; **this design does not change any existing route's permission**, it only records what each one already requires.

## Decisions (locked with user)

1. **Scope:** every deletable entity — all 17 `DELETE` routes — driven by one generic system, not a per-entity implementation.
2. **Modal content:** the **full impact tree** — blockers, cascade deletions, and set-null unlinks.
3. **Delete All authority:** gated by existing RBAC. It removes only what the user holds the matching delete permission for; any node they cannot delete renders locked and blocks the bulk action until an authorized user handles it.
4. **Confirmation friction:** tiered by blast radius. Single row → inline one-click confirm. Delete All → a second screen in the same modal with exact counts, plus a typed confirmation when financial records are involved.
5. **Architecture:** FK graph derived automatically from Drizzle schema metadata; a small hand-written registry supplies only presentation and permission metadata.

## Architecture

### 1. `lib/db/src/dependency-graph.ts` — schema-derived FK graph

Pure module, no app concerns. Built once at module load.

```ts
export type FkEdge = {
  childTable: string;
  childColumn: string;
  parentTable: string;
  parentColumn: string;
  onDelete: "cascade" | "restrict" | "set null" | "no action" | "set default";
};

export const fkEdges: readonly FkEdge[];
export const dependentsOf: ReadonlyMap<string, FkEdge[]>;  // parent table → edges pointing at it
```

Derivation: iterate every table exported from `lib/db/src/schema/index.ts`, call `getTableConfig(table)` from `drizzle-orm/pg-core`, and read `foreignKeys[]`. Each `ForeignKey` exposes `reference()` (`{ columns, foreignTable, foreignColumns }`) and `onDelete`. Invert into `dependentsOf`.

**Verified against drizzle-orm 0.45.2:** `getTableConfig()` reads `table[PgTable.Symbol.InlineForeignKeys]`, which is precisely where column-level `.references(() => x.id, { onDelete })` registers. Every FK in this schema is declared that way, so all are captured. `onDelete` is `undefined` when unspecified and is normalized to `"no action"` (Postgres's default), which is treated as a blocker.

Adding a new FK to the schema makes it appear in the graph with no further work.

### 2. `app/lib/dependencies/descriptors.ts` — presentation + permission registry

The only hand-maintained part. One entry per table:

```ts
type Descriptor = {
  table: string;
  singular: string;                      // "Client Bill"
  plural: string;                        // "Client Bills"
  labelWith: (row: Record<string, unknown>) => string;
  labelColumns: string[];                // columns the resolver must SELECT for labelWith
  href: ((id: number | string) => string) | null;   // detail route, null if none
  deletePermission: string;              // verbatim from the existing route handler
  deleteEndpoint: ((id: number | string) => string) | null;
  financial: boolean;                    // triggers typed confirmation
};
```

`financial: true` on `billings`, `partner_bills`, `payments`, `partner_payments`, and `billing_records`.

Tables with no user-facing delete route (e.g. `payment_billings`, `billing_event_items`, join tables) get `deleteEndpoint: null` and `href: null` — they appear in the impact tree as cascade counts but are never individually actionable.

A unit test asserts every table present in the graph has a descriptor, failing CI on drift.

### 3. `app/lib/dependencies/resolve.ts` — impact resolution

```ts
type ImpactNode = {
  table: string;
  id: number | string;
  label: string;
  href: string | null;
  canDelete: boolean;          // user holds descriptor.deletePermission
  requiredPermission: string;
  deleteEndpoint: string | null;
  children: ImpactNode[];      // recursive blockers only
};

type Impact = {
  target: { table: string; id: number | string; label: string };
  blockers: ImpactNode[];
  cascades: { table: string; label: string; count: number; sample: ImpactNode[] }[];
  nullifies: { table: string; column: string; label: string; count: number }[];
  canDeleteAll: boolean;
  missingPermissions: string[];
  totals: { deletes: number; nullifies: number; touchesFinancial: boolean };
  fingerprint: string;         // stable hash of the full node set
};

async function resolveImpact(
  table: string,
  id: number | string,
  permissions: Set<string>,
): Promise<Impact>;
```

Three deliberate asymmetries, each following from how the user acts on that category:

- **Blockers are enumerated individually and recursed into.** The user must clear them, so each needs an identity, a link, and its own delete action. Recursion follows `restrict` and `no action` edges only. **Depth capped at 4**; **50 rows per level**, with a `+N more` indicator beyond that. Exceeding either cap sets `canDeleteAll: false` with an explanatory reason, since the user cannot have meaningfully reviewed what they're destroying.
- **Cascades are counted, with a 3-row sample.** Deleting a partner cascades every `billing_record` it owns, potentially thousands. A count plus a sample is honest without being unusable. Cascade subtrees are counted transitively (deleting a `billing` cascades its `billing_lines`, which cascade their `billing_event_items`) so `totals.deletes` reflects the true blast radius.
- **Nullifies are counted only.** Nothing is destroyed, so one line per edge suffices.

`canDeleteAll` is false when any node's `deletePermission` is absent from the user's set; `missingPermissions` lists them for display.

`fingerprint` is a stable hash over the sorted `(table, id)` pairs of every node in the tree. It is the concurrency guard (see Error Handling).

### 4. API endpoints

Both added to `lib/api-spec/openapi.yaml` so orval regenerates `lib/api-zod` types and `lib/api-client-react` hooks, per the existing codegen flow.

**`GET /api/dependencies?table={table}&id={id}`** → `Impact`

Gated on the target table's **view** permission. Rejects any `table` not present in the descriptor registry (prevents arbitrary table probing).

**`POST /api/dependencies/delete`** → `{ deleted: { table, count }[] }`

Body: `{ table, id, fingerprint }`.

Behavior:
1. Re-resolve the impact server-side. **Never trust the client's `canDeleteAll`.**
2. Compare fingerprints. Mismatch → `409` with the fresh `Impact`.
3. Re-check every node's `deletePermission` against the session. Any missing → `403` naming the permission.
4. Delete bottom-up within **a single transaction**. Postgres handles `cascade` and `set null` edges natively; the transaction only explicitly deletes blocker nodes, deepest first.
5. Any failure rolls the entire transaction back.

**Per-row deletes in the modal do not use this endpoint.** They call the entity's existing `DELETE` route, so existing permission checks and behavior are reused rather than duplicated. This is safe because all 17 handlers were verified to be pure row deletes with no additional business-logic side effects.

### 5. UI

**`app/hooks/use-delete-with-dependencies.ts`** — the single entry point that replaces every `confirm()` call site:

```ts
const del = useDeleteWithDependencies({
  table: "clients",
  id,
  onDeleted: () => router.push("/clients"),
});
```

It fetches the impact first. **When the tree is empty** — no blockers, no cascades, no nullifies — it renders a plain one-line confirmation instead of the impact modal. There is no reason to show an impact tree for an unused payment term.

**`app/components/ui/delete-impact-dialog.tsx`** — three stacked sections, each hidden when empty:

```
┌─ Delete Client — Acme Corp? ─────────────────────────────┐
│                                                           │
│  Must be deleted first                                    │
│    ▸ Client PO   CPO-2026-0031                  [Delete] │
│        └ Partner PO  PPO-2026-0088              [Delete] │
│        └ Partner PO  PPO-2026-0091              [Delete] │
│    ▸ Client Bill CBILL-0012        🔒 needs billings:edit │
│                                                           │
│  Will also be permanently deleted                         │
│    142 Billing Records · 8 Client Events    [show sample] │
│                                                           │
│  Will be unlinked, not deleted                            │
│    3 Billing Records will lose their client               │
│                                                           │
│  [Cancel]                    [Delete All — 154 records]  │
└───────────────────────────────────────────────────────────┘
```

Each blocker row links to its detail page (new tab) so the record can be inspected before destruction — but navigating away is never required.

**Per-row delete** expands inline on the row into `Delete this Partner PO? [Cancel] [Delete]` — no nested dialog. On success the impact re-fetches, the row disappears, counts update, and when the last blocker clears the primary button changes from `Delete All` to `Delete Client`.

**Delete All** advances to a second screen within the same modal: an itemized breakdown of exactly what will be destroyed, and — when `totals.touchesFinancial` is true — a `Type "Acme Corp" to confirm` text input. Footer becomes `[Back] [Delete Everything]`.

When `canDeleteAll` is false the primary button is disabled with a tooltip naming the missing permissions.

Built on the existing `app/components/ui/alert-dialog.tsx` primitive and the app's established dialog patterns.

## Error handling

| Case | Handling |
|---|---|
| **Concurrent modification** — someone adds a billing while the modal is open | Client sends the `fingerprint` it displayed; server re-resolves and compares. Mismatch → `409` with the fresh tree. Modal shows *"This changed while you were reviewing — 1 new Client Bill was added"* and re-renders. Without this, "Delete All" silently means "delete whatever exists at commit time," which is the exact class of surprise this feature exists to prevent. |
| **Partial failure mid-cascade** | Single transaction — all-or-nothing rollback. Error names the node that failed. |
| **Permission revoked mid-flight** | Server re-checks every node at commit time → `403` naming the missing permission. |
| **FK error the graph missed** (e.g. a constraint added directly in SQL) | Existing `23503` handling retained as a safety net, generalized across all routes and mapped to a readable message naming the constraint's table. |
| **Depth or row cap exceeded** | `canDeleteAll: false` with a reason; per-row deletion still available so the user can work the tree down manually. |
| **Unknown / non-registered table** | `400` — the endpoint only accepts tables present in the descriptor registry. |

## Testing

**Unit — graph derivation** (`lib/db`): assert known schema facts hold, e.g. `billings→clients` resolves as `restrict`, `billing_records→partners` as `cascade`, `clients→buying_houses` as `set null`. These fail loudly if an FK policy changes.

**Unit — descriptor completeness:** every table appearing in `dependentsOf` (as parent or child) has a descriptor entry. Fails CI when a table is added without one.

**Unit — resolver:** depth cap, per-level row cap, transitive cascade counting, permission filtering producing `canDeleteAll: false` and populating `missingPermissions`, `touchesFinancial` set correctly, fingerprint stability across identical trees and change across differing ones.

**Integration — delete endpoint:** successful bottom-up cascade inside a transaction; rollback on a permission failure partway through; `409` on fingerprint mismatch; `403` naming the missing permission; `400` on unregistered table.

**Component:** empty impact renders the simple confirm rather than the modal; locked rows disable Delete All; typed confirmation required only when financial records are present; tree re-fetches and the primary button flips after the final blocker is deleted.

## Rollout

The hook is drop-in, so existing `confirm()` call sites migrate incrementally rather than in a single change. Order: buying houses, clients, partners (the entities where the dead-end is felt most), then purchase orders and billings, then the remaining settings-level entities.

## Explicitly out of scope

- **Soft-delete / voiding of financial records.** Hard-deleting a `billing` or `payment` destroys accounting history, and there is a real argument those should be voided rather than deleted. That is a separate decision with its own schema implications. The impact modal is the natural place it would surface later, but this design does not introduce it.
- **Changing any existing FK policy.** The graph reports what the schema already declares.
- **Changing any existing route's permission slug,** including the `payments:edit`-gates-DELETE inconsistency noted above. The registry records current behavior; normalizing it is separate work.
- **Bulk/multi-select deletion** of several parent entities at once.
- **Closing the legacy-route permission gap.** The tightened rule — that you need the delete permission for everything a delete destroys, cascades included — is enforced only on `POST /api/dependencies/delete`. The original per-entity routes are unchanged, so `DELETE /api/partners/[id]` still requires nothing beyond `partners:delete` and lets Postgres cascade its `billing_records` away, without checking `billings:edit`. Anyone calling that route directly therefore bypasses the new gate. This is an accepted limit, not an oversight: the dialog's cascade-permission check is a UI-level guarantee, not an enforced invariant of the system. Do not cite it as one. Closing it means auditing all 17 legacy `DELETE` handlers, which is separate work.
