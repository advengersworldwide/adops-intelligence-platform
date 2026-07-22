# Granular RBAC — Design Spec

**Date:** 2026-07-22
**Status:** Approved design, pre-implementation
**Scope:** Full-stack role-based access control down to tab and field level, with real server-side enforcement.

---

## 1. Problem & goals

### What exists today (evaluation)

- **Data model** ([lib/db/src/schema/auth.ts](../../../lib/db/src/schema/auth.ts)): `roles = { name, permissions: string[] (jsonb), isSystem }`. `users.role` is a plain **text field holding the role name** (not a foreign key). One role per user. Permissions are flat strings (`"View Clients"`, `"Edit Clients"`, `"Manage Settings"`…).

- **Fragmented catalog.** The permission strings are duplicated across ≥4 places with no single source of truth:
  - [app/scripts/seed.ts](../../../app/scripts/seed.ts) `DEFAULT_ROLES` — 18 permissions (the real superset).
  - [app/app/(dashboard)/settings/page.tsx](../../../app/app/(dashboard)/settings/page.tsx) `ALL_PERMISSIONS` — only 11.
  - [app/components/layout/Sidebar.tsx](../../../app/components/layout/Sidebar.tsx) nav items.
  - Scattered `useHasPermission("…")` string literals across pages/tabs.
  - **Bug:** the Settings role editor is missing 7 permissions the app actually checks (`View Dashboard`, `Edit Clients`, `Edit Partners`, `Edit Buying Houses`, `View Purchase Orders`, `Edit Purchase Orders`). A custom role literally cannot be granted these through the UI.

- **Enforcement — three layers, only one works:**
  1. [app/middleware.ts](../../../app/middleware.ts) checks **authentication only** (valid JWT + rate limit) and **excludes `/api`**. No authorization.
  2. **Client-side gating is the only functioning RBAC** — `Sidebar` hides links, `PermissionGuard` blocks pages, `useHasPermission`/`usePermissionSet` toggle buttons. It runs in the browser off `/api/roles` and is trivially bypassable.
  3. **Server-side authorization is almost absent:** only 8 of ~72 API route files have any guard, and those are coarse (`requireAuth` = any logged-in user, `requireAdmin` = System Admin). The other ~64 routes (clients, partners, buying-houses, billings, payments, purchase-orders, cost, analytics, imports, uploads) have **no authorization** — any authenticated user can `POST`/`PATCH`/`DELETE` by calling the API directly.

- **JWT** ([app/lib/auth/jwt.ts](../../../app/lib/auth/jwt.ts)): embeds role *name* + `isSystem`, 24h expiry. Permissions are not in the token; the client matches them by role-name string (case-insensitive) against `/api/roles`. Renaming a role silently strips access from its users. `"System Admin"` is a magic string hardcoded in ~4 places.

- **Tabs are not gated.** Client detail (Details/Events/**Data**), Partner detail (Details/Clients/**Data**/**Analytics**), Purchase Orders (Clients/Partners), Settings (General/Roles/Users/Cost Models/Payment Terms) each open every tab under one blanket permission. The financial **Data** tabs (receivable, net margin PKR) are visible to any viewer. The one clean declarative pattern is the dashboard widget registry's `permission: string | null` field ([app/lib/dashboard/role-gating.ts](../../../app/lib/dashboard/role-gating.ts)) — worth generalizing.

### Goals

1. One **canonical permission catalog** consumed by every layer — no drift, type-checked.
2. **Real server-side enforcement** on every API route (fail-closed).
3. **Tab-level** gating (including nested tabs) and **field-level** gating for sensitive data.
4. **Workflow/status-action** permissions distinct from edit.
5. Migrate existing roles with **zero behavior change on day one**; admins tighten afterward.

### Non-goals (explicitly out of scope)

- **Row-level / data scoping** (restricting a user to specific clients/buying-houses/partners). Access stays global per module.
- **Multiple roles per user / per-user overrides.** One role per user, as today.
- Building a net-new **partner billing Summary/Detail** view. The catalog reserves keys for it (`billings.partner.summary:view` / `.detail:view`) so it's a one-line addition later, but the view itself is not built here.
- A policy engine (CASL/ABAC). Flat namespaced strings only.

---

## 2. Approach

**Flat namespaced permission strings + one shared catalog** (chosen over structured matrix objects and a policy engine).

- Keep the role's `permissions: string[]` storage.
- Define every permission **once** in `app/lib/rbac/catalog.ts` using a `resource:action` / `resource.sub:view` scheme.
- Every consumer (seed, Settings editor, Sidebar, pages, tab registry, field guards, server route guard) imports that catalog. A typo becomes a TypeScript error.
- Server is the source of truth; client gating is UX only.

Rationale: smallest migration (still a string array), human-readable and diffable, reuses the existing widget-registry pattern, keeps the admin UI a simple grouped-checkbox screen, and closes the server gap. Structured objects and a policy engine were rejected as over-engineered given no scoping + single role.

---

## 3. Permission catalog

Defined in `app/lib/rbac/catalog.ts` as a `const`, grouped by module, each entry carrying display metadata `{ key, label, group, kind }` where `kind ∈ action | tab | field | workflow`. Exports the `Permission` union type and `ALL_PERMISSIONS`. `System Admin` / `isSystem` bypasses all checks.

### Naming scheme
- Module action: `resource:action` — e.g. `clients:view`, `clients:edit`, `clients:delete`.
- Tab (nestable): `resource.tab:view` / `resource.parent.child:view`.
- Field: `resource.field:view`.
- Workflow: `resource:verb` — e.g. `billings:generate-invoice`.

### Modules & actions

| Module | View (page) | Edit | Delete | Other |
|---|---|---|---|---|
| Dashboard | `dashboard:view` | — | — | widgets gated individually (existing) |
| Clients | `clients:view` | `clients:edit` | `clients:delete` | |
| Buying Houses | `buying-houses:view` | `buying-houses:edit` | `buying-houses:delete` | |
| Partners | `partners:view` | `partners:edit` | `partners:delete` | |
| Purchase Orders | `purchase-orders:view` | `purchase-orders:edit` | — | |
| Billings | `billings:view` | `billings:edit` | — | |
| Payments | `payments:view` | `payments:edit` | — | |
| Cost | `cost:view` | `cost:edit` | — | |
| Upload | `upload:data` | — | — | |
| Analytics | `analytics:view` | — | — | `analytics:export` |

### Tab-level

| Page | Tab permissions |
|---|---|
| Client detail | `clients.details:view`, `clients.events:view`, `clients.data:view` (financials) |
| Partner detail | `partners.details:view`, `partners.clients:view`, `partners.data:view`, `partners.analytics:view` |
| Buying House detail | `buying-houses.details:view`, `buying-houses.data:view`, `buying-houses.analytics:view` |
| Purchase Orders | `purchase-orders.clients:view`, `purchase-orders.partners:view` |
| Billing (nested) | `billings.client:view` → { `billings.client.summary:view`, `billings.client.detail:view` }, `billings.partner:view` |
| Settings | `settings.general:view`, `settings.roles:manage`, `settings.users:manage`, `settings.catalogs:manage` |

### Field-level (sensitive fields inside a visible tab)

| Field group | Permission |
|---|---|
| Client bank details | `clients.bank:view` |
| Client tax numbers (NTN/GST) | `clients.tax:view` |
| Partner bank details | `partners.bank:view` |
| Partner payout rates | `partners.payout:view` |
| Billing margin / net receivable columns | `billings.margin:view` |

### Workflow / status actions

| Action | Permission |
|---|---|
| Generate billing invoice | `billings:generate-invoice` |
| Change billing status | `billings:change-status` |
| Change payment status | `payments:change-status` |
| Change PO status | `purchase-orders:change-status` |
| Change partner-payment status | `partner-payments:change-status` |

### Rules

- **Tabs and fields are additive gates on `:view`.** `clients:view` opens the page; `clients.data:view` then decides whether the Data tab shows.
- **Nested tabs:** a parent tab renders only if the user has its permission *and* at least one visible child.
- A user who can `:view` a page but has none of its tab permissions sees a "No accessible sections" state.
- **Fail-closed:** unknown/missing permission = denied.

---

## 4. Enforcement architecture

### 4.1 RBAC core — `app/lib/rbac/`

- `catalog.ts` — permissions as a `const` with metadata; exports `Permission` type + `ALL_PERMISSIONS` + grouped structure for the admin UI. Replaces the 4 scattered lists.
- `can.ts` — `can(granted: Set<string>, perm: Permission): boolean`, with the `isSystem` / `System Admin` bypass centralized (removes the hardcoded magic strings).
- `tabs.ts` — the **tab registry**: each tabbed page → tree of `{ id, label, permission, children? }`.

### 4.2 Server-side guard

- New `requirePermission(perm: Permission)` in [app/lib/auth/require.ts](../../../app/lib/auth/require.ts), following the existing `requireAuth`/`requireAdmin` shape:
  `getSession()` → resolve the role's permissions from `rolesTable` → `can()` → `403` if missing, else `{ user }`.
- Role→permissions resolved **fresh from DB per request**, cached in a short-TTL (~30s) in-memory map so role edits take effect promptly without waiting out the 24h JWT. Permissions are deliberately **not** baked into the token. Cache is invalidated on role write (`POST /api/roles`).
- Applied to **every** route handler, **per method**: `GET` → `:view`; `POST`/`PATCH`/`PUT` → `:edit`; `DELETE` → `:delete` (or `:edit` where no delete perm exists); status routes → `:change-status`; invoice route → `:generate-invoice`; imports → `upload:data`; analytics → `analytics:view`.
- **Partner payables routes** (`partner-bills`, `partner-payments`) are enforced under the existing money modules: `GET` → `billings:view` / `payments:view`, `POST`/`PATCH`/`DELETE` → `billings:edit` / `payments:edit`, and `partner-payments/[id]/status` → `partner-payments:change-status`. No separate top-level "partner-payments" module view is introduced.
- **Regression guard:** a test scans `app/app/api/**/route.ts` and fails if any exported HTTP handler doesn't reference a `require*` guard. `auth/me` uses `requireAuth` (authenticated, no specific permission) and so passes the scan. Public allow-list (no guard required): `healthz`, `users/login`, `users/logout`.

### 4.3 Session & `/api/auth/me`

- `/api/auth/me` returns `{ id, name, email, role, isSystem, permissions: string[] }` (effective set resolved server-side).
- `GET /api/roles` locked to `settings.roles:manage` (today it's world-readable and the client's permission source — a leak and fragile).
- JWT payload unchanged (role name + `isSystem`, 24h).

### 4.4 Client-side (thin, mirrors server)

- `UserProvider` ([app/lib/auth/user-context.tsx](../../../app/lib/auth/user-context.tsx)) holds `permissions` from `/api/auth/me`. `useCan(perm)` / `useHasPermission` / `usePermissionSet` read the in-context set — no more fetching `/api/roles`, no case-insensitive role-name matching. `PermissionGuard` keeps its API but reads the new source.
- Sidebar's `canAccess` + Financials-group logic switch to `useCan`.

### 4.5 Tab-level gating

- `<GatedTabs node={...}>` (or `useVisibleTabs(node)`) reads the tab registry, filters triggers + content by `can()`, **supports nesting** (Billing Client→Summary/Detail), auto-selects the first visible tab, and renders "No accessible sections" if none. Replaces ad-hoc `{canDetail && <TabsTrigger/>}`.

### 4.6 Field-level gating

- `useCan(perm)` conditionals + a small `<Gated permission>` wrapper for hide, and a `readOnly`/mask convention for show-but-locked (e.g. bank fields visible but not editable). Applied to bank/tax/payout/margin fields.

### Trust model
- Server enforces `403` regardless of UI. Client gating is purely UX. **Defense in depth:** a hidden tab's underlying API still rejects hand-crafted requests. **Fail-closed** everywhere.

---

## 5. Settings admin UI

- Role editor **generated from `catalog.ts`**, grouped by module, nested rows for tab/field/workflow perms, per-group "select all," parent→child cascade (ticking `clients.data:view` implies `clients:view`). Because it's generated, the missing-permissions bug is fixed by construction.
- `"Manage Settings"` splits into the four `settings.*` perms; the Settings tabs (General / Roles / Users / Catalogs) route through the tab registry. A "Catalog Manager" role sees only Cost Models + Payment Terms.
- System roles remain read-only. Optional read-only "effective permissions" preview per role.

---

## 6. Data migration

**Principle: zero behavior change on day one.** Whoever could see/do something before still can immediately after; new granular gates default **open** for roles that had the parent. Admins tighten from a working baseline.

One-time migration rewrites each role's `permissions` array old→new:

| Old | New |
|---|---|
| `View Dashboard` | `dashboard:view` |
| `View Clients` | `clients:view` + `clients.details:view` + `clients.events:view` + `clients.data:view` + `clients.bank:view` + `clients.tax:view` |
| `Edit Clients` | `clients:edit` |
| `View Partners` | `partners:view` + all `partners.*` tabs + `partners.bank:view` + `partners.payout:view` |
| `Edit Partners` | `partners:edit` |
| `View Buying Houses` | `buying-houses:view` + all `buying-houses.*` tabs |
| `Edit Buying Houses` | `buying-houses:edit` |
| `View Purchase Orders` | `purchase-orders:view` + `purchase-orders.clients:view` + `purchase-orders.partners:view` |
| `Edit Purchase Orders` | `purchase-orders:edit` + `purchase-orders:change-status` |
| `View Billings` | `billings:view` + `billings.client:view` + `billings.client.summary:view` + `billings.partner:view` + `billings.margin:view` |
| `View Billing Detail` | `billings.client.detail:view` |
| `View Payments` | `payments:view` |
| `View Cost` | `cost:view` |
| `View Analytics` | `analytics:view` |
| `Upload Data` | `upload:data` |
| `Manage Settings` | `settings.general:view` + `settings.roles:manage` + `settings.users:manage` + `settings.catalogs:manage` |
| `View Transactions` | dropped (legacy media model retired) |

- **Delete permissions** (`clients:delete`, `partners:delete`, `buying-houses:delete`) start **off** for everyone except System Admin; admins grant explicitly.
- **Billing workflow** (`billings:edit`, `billings:generate-invoice`, `billings:change-status`) and **payment workflow** (`payments:edit`, `payments:change-status`, `partner-payments:change-status`) grant to roles that had the corresponding edit intent (Operator/System Admin) so existing operators keep working; Viewer does not receive them.
- Migration is a Drizzle migration + script (or run in seed), covering system roles (rewritten in seed) and custom roles (mapped). Mapping must be total and lossless (asserted by test).

### Seed (`DEFAULT_ROLES` rewritten to catalog keys)

- **System Admin** — all permissions (also bypasses via `isSystem`).
- **Operator** — everything except `settings.roles:manage` and `settings.users:manage`; no `*:delete`.
- **Viewer** — all `:view` + all tab perms + sensitive-field views; no `:edit`, no workflow, no delete, no settings management.

---

## 7. Testing

- **Unit:** catalog integrity (unique keys; every tab/field points at a real parent; every registry & sidebar permission exists in the catalog); `can()` + bypass; nested tab-tree filtering; migration map is total & lossless.
- **API:** representative `403`-without / `200`-with tests per permission kind (view, edit, delete, workflow); the **"every route is guarded"** scanner test.
- **Component:** `GatedTabs` nesting + "No accessible sections" empty state; field-gate render tests (hidden vs read-only).

---

## 8. Rollout — 5 phases, each independently shippable

1. **RBAC core** — `catalog.ts`, `can.ts`, `tabs.ts`, types, `/api/auth/me`, client hooks + Sidebar re-plumbed to the new source. No behavior change.
2. **Server enforcement** — `requirePermission` on all ~72 routes + regression scanner. Closes the security hole.
3. **Tab + field gating** — client / partner / buying-house / billing-nested / settings pages.
4. **Grouped role editor** + Settings tab gating.
5. **Migration + seed rewrite**; full test suite green.

Rationale: build the shared core, lock the server first (highest value), layer UI granularity, then admin tooling, then migrate roles onto the final catalog. Migration ships atomically with the seed/catalog so production roles map over on deploy.

---

## 9. Key components (isolation & responsibilities)

| Unit | Responsibility | Depends on |
|---|---|---|
| `app/lib/rbac/catalog.ts` | Canonical permission list + metadata + `Permission` type | none |
| `app/lib/rbac/can.ts` | Pure allow/deny decision + admin bypass | catalog |
| `app/lib/rbac/tabs.ts` | Tab registry (nestable trees per page) | catalog |
| `app/lib/auth/require.ts` | `requirePermission` server guard + role→perm resolution/cache | catalog, can, db, session |
| `/api/auth/me` | Return current user's effective permission set | require/session, db |
| `UserProvider` + `useCan` | Client permission context | `/api/auth/me`, can |
| `<GatedTabs>` | Render only permitted (nested) tabs | tabs, can |
| `<Gated>` / field guards | Hide/lock sensitive fields | can |
| Settings role editor | Generated grouped permission editor | catalog |
| migration + seed | Map old→new; default roles | catalog |