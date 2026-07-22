# Granular RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the UI-only, flat-permission RBAC with a catalog-driven system that enforces tab-, field-, and workflow-level permissions on both the server (every API route) and the client.

**Architecture:** One canonical permission catalog in `app/lib/rbac/` is imported by every layer. The server resolves a user's effective permissions from the DB (short-TTL cached) and returns `403` when missing; the client mirrors the same set from `/api/auth/me` for UX gating only. Tabs are gated by a registry of (nestable) trees; sensitive fields by inline `useCan` checks. Migration rewrites existing roles onto the new keys with zero day-one behavior change.

**Tech Stack:** Next.js 15 (App Router), TypeScript, Drizzle ORM + PostgreSQL, Vitest, TanStack Query, Radix Tabs.

**Reference spec:** `docs/superpowers/specs/2026-07-22-rbac-granular-design.md`

**Conventions for every task:**
- All test/typecheck commands run from the `app/` directory.
- Run a single test file: `pnpm exec vitest run <relative/path.test.ts>`
- Typecheck: `pnpm exec tsc -p tsconfig.json --noEmit`
- Commit after each task's tests pass.

---

## Phase 1 — RBAC core (no behavior change)

### Task 1: Permission catalog

**Files:**
- Create: `app/lib/rbac/catalog.ts`
- Test: `app/lib/rbac/catalog.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/lib/rbac/catalog.test.ts
import { describe, it, expect } from "vitest";
import { PERMISSIONS, ALL_PERMISSIONS } from "./catalog";

describe("permission catalog", () => {
  it("has unique keys", () => {
    const keys = PERMISSIONS.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("exposes ALL_PERMISSIONS matching PERMISSIONS keys", () => {
    expect(ALL_PERMISSIONS).toEqual(PERMISSIONS.map((p) => p.key));
  });

  it("every tab/field key has a parent module :view or nested parent", () => {
    const keys = new Set(PERMISSIONS.map((p) => p.key));
    for (const p of PERMISSIONS) {
      if (p.kind !== "tab" && p.kind !== "field") continue;
      // key form: "module.sub:view" or "module.parent.child:view"
      const [path] = p.key.split(":");
      const segments = path.split(".");
      const moduleView = `${segments[0]}:view`;
      expect(keys.has(moduleView), `${p.key} needs ${moduleView}`).toBe(true);
    }
  });

  it("includes the settings split and nested billing tabs", () => {
    const keys = new Set(PERMISSIONS.map((p) => p.key));
    for (const k of [
      "settings.roles:manage", "settings.users:manage",
      "settings.catalogs:manage", "settings.general:view",
      "billings.client.summary:view", "billings.client.detail:view",
    ]) {
      expect(keys.has(k), `missing ${k}`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/rbac/catalog.test.ts`
Expected: FAIL — cannot find module `./catalog`.

- [ ] **Step 3: Write the catalog**

```ts
// app/lib/rbac/catalog.ts
export type PermissionKind = "action" | "tab" | "field" | "workflow";

export interface PermissionDef {
  key: string;
  label: string;
  group: string;
  kind: PermissionKind;
}

export const SYSTEM_ADMIN_ROLE = "System Admin";

export const PERMISSIONS = [
  // Dashboard
  { key: "dashboard:view", label: "View Dashboard", group: "Dashboard", kind: "action" },

  // Clients
  { key: "clients:view", label: "View Clients", group: "Clients", kind: "action" },
  { key: "clients:edit", label: "Edit Clients", group: "Clients", kind: "action" },
  { key: "clients:delete", label: "Delete Clients", group: "Clients", kind: "action" },
  { key: "clients.details:view", label: "Client · Details tab", group: "Clients", kind: "tab" },
  { key: "clients.events:view", label: "Client · Events tab", group: "Clients", kind: "tab" },
  { key: "clients.data:view", label: "Client · Data (financials) tab", group: "Clients", kind: "tab" },
  { key: "clients.bank:view", label: "Client · Bank details", group: "Clients", kind: "field" },
  { key: "clients.tax:view", label: "Client · Tax numbers", group: "Clients", kind: "field" },

  // Buying Houses
  { key: "buying-houses:view", label: "View Buying Houses", group: "Buying Houses", kind: "action" },
  { key: "buying-houses:edit", label: "Edit Buying Houses", group: "Buying Houses", kind: "action" },
  { key: "buying-houses:delete", label: "Delete Buying Houses", group: "Buying Houses", kind: "action" },
  { key: "buying-houses.details:view", label: "Buying House · Details tab", group: "Buying Houses", kind: "tab" },
  { key: "buying-houses.data:view", label: "Buying House · Data tab", group: "Buying Houses", kind: "tab" },
  { key: "buying-houses.analytics:view", label: "Buying House · Analytics tab", group: "Buying Houses", kind: "tab" },

  // Partners
  { key: "partners:view", label: "View Partners", group: "Partners", kind: "action" },
  { key: "partners:edit", label: "Edit Partners", group: "Partners", kind: "action" },
  { key: "partners:delete", label: "Delete Partners", group: "Partners", kind: "action" },
  { key: "partners.details:view", label: "Partner · Details tab", group: "Partners", kind: "tab" },
  { key: "partners.clients:view", label: "Partner · Clients tab", group: "Partners", kind: "tab" },
  { key: "partners.data:view", label: "Partner · Data tab", group: "Partners", kind: "tab" },
  { key: "partners.analytics:view", label: "Partner · Analytics tab", group: "Partners", kind: "tab" },
  { key: "partners.bank:view", label: "Partner · Bank details", group: "Partners", kind: "field" },
  { key: "partners.payout:view", label: "Partner · Payout rates", group: "Partners", kind: "field" },

  // Purchase Orders
  { key: "purchase-orders:view", label: "View Purchase Orders", group: "Purchase Orders", kind: "action" },
  { key: "purchase-orders:edit", label: "Edit Purchase Orders", group: "Purchase Orders", kind: "action" },
  { key: "purchase-orders:change-status", label: "Change PO status", group: "Purchase Orders", kind: "workflow" },
  { key: "purchase-orders.clients:view", label: "PO · Clients tab", group: "Purchase Orders", kind: "tab" },
  { key: "purchase-orders.partners:view", label: "PO · Partners tab", group: "Purchase Orders", kind: "tab" },

  // Billings
  { key: "billings:view", label: "View Billings", group: "Billings", kind: "action" },
  { key: "billings:edit", label: "Edit Billings", group: "Billings", kind: "action" },
  { key: "billings:generate-invoice", label: "Generate invoice", group: "Billings", kind: "workflow" },
  { key: "billings:change-status", label: "Change billing status", group: "Billings", kind: "workflow" },
  { key: "billings.client:view", label: "Billing · Client tab", group: "Billings", kind: "tab" },
  { key: "billings.client.summary:view", label: "Billing · Client Summary", group: "Billings", kind: "tab" },
  { key: "billings.client.detail:view", label: "Billing · Client Detail", group: "Billings", kind: "tab" },
  { key: "billings.partner:view", label: "Billing · Partner tab", group: "Billings", kind: "tab" },
  { key: "billings.margin:view", label: "Billing · Margin/receivable columns", group: "Billings", kind: "field" },

  // Payments
  { key: "payments:view", label: "View Payments", group: "Payments", kind: "action" },
  { key: "payments:edit", label: "Edit Payments", group: "Payments", kind: "action" },
  { key: "payments:change-status", label: "Change payment status", group: "Payments", kind: "workflow" },
  { key: "partner-payments:change-status", label: "Change partner-payment status", group: "Payments", kind: "workflow" },

  // Cost
  { key: "cost:view", label: "View Cost", group: "Cost", kind: "action" },
  { key: "cost:edit", label: "Edit Cost", group: "Cost", kind: "action" },

  // Upload
  { key: "upload:data", label: "Upload Data", group: "Upload", kind: "action" },

  // Analytics
  { key: "analytics:view", label: "View Analytics", group: "Analytics", kind: "action" },
  { key: "analytics:export", label: "Export Analytics", group: "Analytics", kind: "action" },

  // Settings (splits the old "Manage Settings")
  { key: "settings.general:view", label: "Settings · General/Currency/Tax", group: "Settings", kind: "tab" },
  { key: "settings.roles:manage", label: "Settings · Roles & Rights", group: "Settings", kind: "tab" },
  { key: "settings.users:manage", label: "Settings · User Accounts", group: "Settings", kind: "tab" },
  { key: "settings.catalogs:manage", label: "Settings · Cost Models & Payment Terms", group: "Settings", kind: "tab" },
] as const satisfies readonly PermissionDef[];

export type Permission = (typeof PERMISSIONS)[number]["key"];

export const ALL_PERMISSIONS: Permission[] = PERMISSIONS.map((p) => p.key);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run lib/rbac/catalog.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/rbac/catalog.ts app/lib/rbac/catalog.test.ts
git commit -m "feat(rbac): canonical permission catalog"
```

---

### Task 2: `can` + effective-permission resolver (admin bypass in one place)

**Files:**
- Create: `app/lib/rbac/can.ts`
- Test: `app/lib/rbac/can.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/lib/rbac/can.test.ts
import { describe, it, expect } from "vitest";
import { can, isSuperAdmin, effectivePermissions } from "./can";
import { ALL_PERMISSIONS } from "./catalog";

describe("can / effectivePermissions", () => {
  it("membership check", () => {
    const set = new Set(["clients:view"]);
    expect(can(set, "clients:view")).toBe(true);
    expect(can(set, "clients:edit")).toBe(false);
  });

  it("isSuperAdmin true for isSystem or System Admin role", () => {
    expect(isSuperAdmin({ role: "Viewer", isSystem: true })).toBe(true);
    expect(isSuperAdmin({ role: "System Admin", isSystem: false })).toBe(true);
    expect(isSuperAdmin({ role: "Viewer", isSystem: false })).toBe(false);
  });

  it("super admin gets the full catalog", () => {
    const eff = effectivePermissions({ role: "System Admin", isSystem: false }, []);
    expect(eff.size).toBe(ALL_PERMISSIONS.length);
    expect(eff.has("settings.roles:manage")).toBe(true);
  });

  it("non-admin gets exactly their role permissions", () => {
    const eff = effectivePermissions({ role: "Viewer", isSystem: false }, ["clients:view"]);
    expect([...eff]).toEqual(["clients:view"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/rbac/can.test.ts`
Expected: FAIL — cannot find module `./can`.

- [ ] **Step 3: Write the implementation**

```ts
// app/lib/rbac/can.ts
import { ALL_PERMISSIONS, SYSTEM_ADMIN_ROLE, type Permission } from "./catalog";

export interface Principal {
  role: string;
  isSystem: boolean;
}

export function isSuperAdmin(p: Principal): boolean {
  return p.isSystem || p.role === SYSTEM_ADMIN_ROLE;
}

export function can(granted: Set<string>, perm: Permission): boolean {
  return granted.has(perm);
}

/** Single place the admin bypass lives. Used by the server guard and /api/auth/me. */
export function effectivePermissions(principal: Principal, rolePermissions: string[]): Set<string> {
  if (isSuperAdmin(principal)) return new Set(ALL_PERMISSIONS);
  return new Set(rolePermissions);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run lib/rbac/can.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/rbac/can.ts app/lib/rbac/can.test.ts
git commit -m "feat(rbac): can() + effective-permission resolver with centralized admin bypass"
```

---

### Task 3: Tab registry + `visibleTabs`

**Files:**
- Create: `app/lib/rbac/tabs.ts`
- Test: `app/lib/rbac/tabs.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/lib/rbac/tabs.test.ts
import { describe, it, expect } from "vitest";
import { visibleTabs, type TabNode } from "./tabs";

const tree: TabNode[] = [
  {
    id: "client", label: "Client", permission: "billings.client:view",
    children: [
      { id: "summary", label: "Summary", permission: "billings.client.summary:view" },
      { id: "detail", label: "Detail", permission: "billings.client.detail:view" },
    ],
  },
  { id: "partner", label: "Partner", permission: "billings.partner:view" },
];

describe("visibleTabs", () => {
  it("keeps only permitted leaves", () => {
    const can = (p: string) => p === "billings.partner:view";
    const out = visibleTabs(tree, can);
    expect(out.map((t) => t.id)).toEqual(["partner"]);
  });

  it("hides a parent whose children are all denied", () => {
    const can = (p: string) => p === "billings.client:view"; // parent yes, children no
    const out = visibleTabs(tree, can);
    expect(out).toEqual([]);
  });

  it("keeps a parent with at least one visible child", () => {
    const can = (p: string) =>
      p === "billings.client:view" || p === "billings.client.summary:view";
    const out = visibleTabs(tree, can);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("client");
    expect(out[0].children!.map((c) => c.id)).toEqual(["summary"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/rbac/tabs.test.ts`
Expected: FAIL — cannot find module `./tabs`.

- [ ] **Step 3: Write the implementation**

```ts
// app/lib/rbac/tabs.ts
import type { Permission } from "./catalog";

export interface TabNode {
  id: string;
  label: string;
  permission: Permission;
  children?: TabNode[];
}

/** Returns the subset of nodes the user may see. A parent with children renders
 *  only when it is itself permitted AND has >= 1 visible child. */
export function visibleTabs(nodes: TabNode[], can: (p: Permission) => boolean): TabNode[] {
  const out: TabNode[] = [];
  for (const n of nodes) {
    if (n.children && n.children.length > 0) {
      const children = visibleTabs(n.children, can);
      if (can(n.permission) && children.length > 0) out.push({ ...n, children });
    } else if (can(n.permission)) {
      out.push({ ...n });
    }
  }
  return out;
}

// Registries consumed by pages (Phase 3).
export const CLIENT_DETAIL_TABS: TabNode[] = [
  { id: "details", label: "Details", permission: "clients.details:view" },
  { id: "events", label: "Events", permission: "clients.events:view" },
  { id: "data", label: "Data", permission: "clients.data:view" },
];

export const PARTNER_DETAIL_TABS: TabNode[] = [
  { id: "details", label: "Details", permission: "partners.details:view" },
  { id: "clients", label: "Clients", permission: "partners.clients:view" },
  { id: "data", label: "Data", permission: "partners.data:view" },
  { id: "analytics", label: "Analytics", permission: "partners.analytics:view" },
];

export const BUYING_HOUSE_DETAIL_TABS: TabNode[] = [
  { id: "details", label: "Details", permission: "buying-houses.details:view" },
  { id: "data", label: "Data", permission: "buying-houses.data:view" },
  { id: "analytics", label: "Analytics", permission: "buying-houses.analytics:view" },
];

export const PURCHASE_ORDER_TABS: TabNode[] = [
  { id: "clients", label: "Clients", permission: "purchase-orders.clients:view" },
  { id: "partners", label: "Partners", permission: "purchase-orders.partners:view" },
];

export const BILLING_TABS: TabNode[] = [
  {
    id: "client", label: "Client", permission: "billings.client:view",
    children: [
      { id: "summary", label: "Summary", permission: "billings.client.summary:view" },
      { id: "detail", label: "Detail", permission: "billings.client.detail:view" },
    ],
  },
  { id: "partner", label: "Partner", permission: "billings.partner:view" },
];

export const SETTINGS_TABS: TabNode[] = [
  { id: "general", label: "Currency & Appearance", permission: "settings.general:view" },
  { id: "roles", label: "Roles & Rights", permission: "settings.roles:manage" },
  { id: "users", label: "User Accounts", permission: "settings.users:manage" },
  { id: "costModels", label: "Cost Models", permission: "settings.catalogs:manage" },
  { id: "paymentTerms", label: "Payment Terms", permission: "settings.catalogs:manage" },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run lib/rbac/tabs.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/rbac/tabs.ts app/lib/rbac/tabs.test.ts
git commit -m "feat(rbac): nestable tab registry + visibleTabs filter"
```

---

### Task 4: Cached role→permissions resolver

**Files:**
- Create: `app/lib/rbac/role-permissions.ts`
- Test: `app/lib/rbac/role-permissions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/lib/rbac/role-permissions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const selectMock = vi.fn();
vi.mock("@workspace/db", () => ({
  db: { select: () => ({ from: () => ({ where: selectMock }) }) },
  rolesTable: { name: "name" },
}));

import { getRolePermissions, clearRolePermissionsCache } from "./role-permissions";

beforeEach(() => {
  clearRolePermissionsCache();
  selectMock.mockReset();
});

describe("getRolePermissions", () => {
  it("returns the role's permissions", async () => {
    selectMock.mockResolvedValueOnce([{ name: "Viewer", permissions: ["clients:view"] }]);
    expect(await getRolePermissions("Viewer")).toEqual(["clients:view"]);
  });

  it("caches within TTL (one DB read for two calls)", async () => {
    selectMock.mockResolvedValueOnce([{ name: "Viewer", permissions: ["clients:view"] }]);
    await getRolePermissions("Viewer");
    await getRolePermissions("Viewer");
    expect(selectMock).toHaveBeenCalledTimes(1);
  });

  it("returns [] for an unknown role", async () => {
    selectMock.mockResolvedValueOnce([]);
    expect(await getRolePermissions("Ghost")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/rbac/role-permissions.test.ts`
Expected: FAIL — cannot find module `./role-permissions`.

- [ ] **Step 3: Write the implementation**

```ts
// app/lib/rbac/role-permissions.ts
import { eq } from "drizzle-orm";
import { db, rolesTable } from "@workspace/db";

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { perms: string[]; expires: number }>();

export async function getRolePermissions(roleName: string): Promise<string[]> {
  const now = Date.now();
  const hit = cache.get(roleName);
  if (hit && hit.expires > now) return hit.perms;
  const rows = await db.select().from(rolesTable).where(eq(rolesTable.name, roleName));
  const perms = rows[0]?.permissions ?? [];
  cache.set(roleName, { perms, expires: now + CACHE_TTL_MS });
  return perms;
}

export function clearRolePermissionsCache(): void {
  cache.clear();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run lib/rbac/role-permissions.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/rbac/role-permissions.ts app/lib/rbac/role-permissions.test.ts
git commit -m "feat(rbac): short-TTL cached role->permissions resolver"
```

---

### Task 5: `/api/auth/me` returns effective permissions

**Files:**
- Modify: `app/app/api/auth/me/route.ts`
- Test: `app/app/api/auth/me/route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/app/api/auth/me/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const getSession = vi.fn();
vi.mock("@/lib/auth/session", () => ({ getSession }));
const getRolePermissions = vi.fn();
vi.mock("@/lib/rbac/role-permissions", () => ({ getRolePermissions }));

import { GET } from "./route";

beforeEach(() => { getSession.mockReset(); getRolePermissions.mockReset(); });

describe("GET /api/auth/me", () => {
  it("401 when unauthenticated", async () => {
    getSession.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns the role's permission set for a normal user", async () => {
    getSession.mockResolvedValueOnce({ sub: 2, name: "V", email: "v@x.com", role: "Viewer", isSystem: false });
    getRolePermissions.mockResolvedValueOnce(["clients:view"]);
    const res = await GET();
    const body = await res.json();
    expect(body.permissions).toEqual(["clients:view"]);
  });

  it("returns the full catalog for a system admin", async () => {
    getSession.mockResolvedValueOnce({ sub: 1, name: "A", email: "a@x.com", role: "System Admin", isSystem: true });
    getRolePermissions.mockResolvedValueOnce([]);
    const res = await GET();
    const body = await res.json();
    expect(body.permissions).toContain("settings.roles:manage");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run app/api/auth/me/route.test.ts`
Expected: FAIL — `permissions` undefined.

- [ ] **Step 3: Update the route**

```ts
// app/app/api/auth/me/route.ts
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getRolePermissions } from "@/lib/rbac/role-permissions";
import { effectivePermissions } from "@/lib/rbac/can";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const rolePerms = await getRolePermissions(user.role);
  const eff = effectivePermissions({ role: user.role, isSystem: user.isSystem ?? false }, rolePerms);
  return NextResponse.json({
    id: user.sub,
    name: user.name,
    email: user.email,
    role: user.role,
    isSystem: user.isSystem ?? false,
    permissions: [...eff],
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run app/api/auth/me/route.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/app/api/auth/me/route.ts app/app/api/auth/me/route.test.ts
git commit -m "feat(rbac): /api/auth/me returns effective permission set"
```

---

### Task 6: Client permission context (`useCan`, thin hooks)

**Files:**
- Modify: `app/lib/auth/user-context.tsx`
- Test: `app/lib/auth/user-context.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// app/lib/auth/user-context.test.tsx
import { describe, it, expect } from "vitest";
import { computeCan } from "./user-context";

describe("computeCan", () => {
  it("grants when permission present", () => {
    expect(computeCan(["clients:view"], "clients:view")).toBe(true);
  });
  it("denies when absent", () => {
    expect(computeCan(["clients:view"], "clients:edit")).toBe(false);
  });
  it("denies when permissions null (still loading)", () => {
    expect(computeCan(null, "clients:view")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/auth/user-context.test.tsx`
Expected: FAIL — `computeCan` not exported.

- [ ] **Step 3: Rewrite the context to hold permissions from `/api/auth/me`**

Replace the file contents:

```tsx
// app/lib/auth/user-context.tsx
"use client";

import { createContext, useContext, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { Permission } from "@/lib/rbac/catalog";

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  role: string;
  isSystem: boolean;
  permissions: string[];
}

interface UserContextValue {
  user: SessionUser | null;
  isLoading: boolean;
}

const UserContext = createContext<UserContextValue>({ user: null, isLoading: true });

export function computeCan(permissions: string[] | null, permission: Permission): boolean {
  if (!permissions) return false;
  return permissions.includes(permission);
}

export function UserProvider({ children }: { children: React.ReactNode }) {
  const { data: user = null, isLoading } = useQuery<SessionUser | null>({
    queryKey: ["me"],
    queryFn: async () => {
      const res = await fetch("/api/auth/me");
      if (!res.ok) return null;
      return res.json() as Promise<SessionUser>;
    },
    staleTime: Infinity,
    retry: false,
  });

  return <UserContext.Provider value={{ user, isLoading }}>{children}</UserContext.Provider>;
}

export function useUser(): SessionUser | null {
  return useContext(UserContext).user;
}

/** Returns true/false, or null while the session is still loading. */
export function useHasPermission(permission: Permission): boolean | null {
  const { user, isLoading } = useContext(UserContext);
  if (isLoading) return null;
  if (!user) return false;
  return computeCan(user.permissions, permission);
}

export function useCan(): (permission: Permission) => boolean {
  const { user } = useContext(UserContext);
  const set = useMemo(() => new Set(user?.permissions ?? []), [user?.permissions]);
  return (permission: Permission) => set.has(permission);
}

export function usePermissionSet(): { has: (p: Permission) => boolean; isLoading: boolean } {
  const { user, isLoading } = useContext(UserContext);
  const set = useMemo(() => new Set(user?.permissions ?? []), [user?.permissions]);
  return { has: (p: Permission) => set.has(p), isLoading };
}

export function useLogout() {
  const router = useRouter();
  const queryClient = useQueryClient();
  return async () => {
    await fetch("/api/users/logout", { method: "POST" });
    queryClient.clear();
    router.push("/login");
  };
}
```

> Note: `useHasPermission`/`usePermissionSet`/`useCan` now take the typed `Permission`. The old string-literal call sites are updated in Phase 3; anything still passing a legacy string (e.g. `"View Cost"`) will be a TS error, which is how we find them.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run lib/auth/user-context.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/auth/user-context.tsx app/lib/auth/user-context.test.tsx
git commit -m "feat(rbac): client permission context from /api/auth/me (useCan)"
```

---

### Task 7: `<GatedTabs>` component

**Files:**
- Create: `app/components/rbac/GatedTabs.tsx`
- Create: `app/components/rbac/Gated.tsx`
- Test: `app/components/rbac/GatedTabs.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// app/components/rbac/GatedTabs.test.tsx
import { describe, it, expect } from "vitest";
import { pickDefaultTab } from "./GatedTabs";
import type { TabNode } from "@/lib/rbac/tabs";

const nodes: TabNode[] = [
  { id: "a", label: "A", permission: "clients.details:view" },
  { id: "b", label: "B", permission: "clients.events:view" },
];

describe("pickDefaultTab", () => {
  it("returns the first visible leaf id", () => {
    expect(pickDefaultTab(nodes)).toBe("a");
  });
  it("descends into a nested parent for its first child id", () => {
    const nested: TabNode[] = [
      { id: "client", label: "Client", permission: "billings.client:view",
        children: [{ id: "summary", label: "S", permission: "billings.client.summary:view" }] },
    ];
    expect(pickDefaultTab(nested)).toBe("summary");
  });
  it("returns null when empty", () => {
    expect(pickDefaultTab([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run components/rbac/GatedTabs.test.tsx`
Expected: FAIL — cannot find module `./GatedTabs`.

- [ ] **Step 3: Write the components**

```tsx
// app/components/rbac/Gated.tsx
"use client";
import { useCan } from "@/lib/auth/user-context";
import type { Permission } from "@/lib/rbac/catalog";

export function Gated({ permission, children }: { permission: Permission; children: React.ReactNode }) {
  const can = useCan();
  if (!can(permission)) return null;
  return <>{children}</>;
}
```

```tsx
// app/components/rbac/GatedTabs.tsx
"use client";

import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useCan } from "@/lib/auth/user-context";
import { visibleTabs, type TabNode } from "@/lib/rbac/tabs";

export function pickDefaultTab(nodes: TabNode[]): string | null {
  const first = nodes[0];
  if (!first) return null;
  if (first.children && first.children.length > 0) return pickDefaultTab(first.children);
  return first.id;
}

/**
 * Renders a Radix Tabs whose triggers/content are filtered by permission.
 * `content` maps a leaf tab id -> node to render. Nested trees render as
 * an inner GatedTabs.
 */
export function GatedTabs({
  nodes,
  content,
  className,
}: {
  nodes: TabNode[];
  content: Record<string, React.ReactNode>;
  className?: string;
}) {
  const can = useCan();
  const visible = visibleTabs(nodes, can);
  const def = pickDefaultTab(visible);

  if (!def) {
    return (
      <p className="px-5 py-8 text-center text-sm text-muted-foreground">
        No accessible sections.
      </p>
    );
  }

  const topDefault = visible[0].id;

  return (
    <Tabs defaultValue={topDefault} className={className}>
      <TabsList>
        {visible.map((t) => (
          <TabsTrigger key={t.id} value={t.id} data-testid={`tab-${t.id}`}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {visible.map((t) => (
        <TabsContent key={t.id} value={t.id} className="mt-4">
          {t.children && t.children.length > 0 ? (
            <GatedTabs nodes={t.children} content={content} />
          ) : (
            content[t.id] ?? null
          )}
        </TabsContent>
      ))}
    </Tabs>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run components/rbac/GatedTabs.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm exec tsc -p tsconfig.json --noEmit
git add app/components/rbac/GatedTabs.tsx app/components/rbac/Gated.tsx app/components/rbac/GatedTabs.test.tsx
git commit -m "feat(rbac): GatedTabs + Gated field wrapper"
```

> Typecheck will surface every stale `useHasPermission("Legacy String")` call site now that the hooks require `Permission`. Fixing those call sites happens in Phase 3; if the typecheck is noisy here, note the failing files and proceed — they're the Phase 3 worklist.

---

### Task 8: Re-plumb the Sidebar to `useCan`

**Files:**
- Modify: `app/components/layout/Sidebar.tsx:22-59`

- [ ] **Step 1: Replace nav permission strings with catalog keys and swap `canAccess`**

Update the three nav arrays to use catalog keys and replace the `canAccess` implementation:

```tsx
// app/components/layout/Sidebar.tsx  (nav arrays)
const topNavItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, permission: "dashboard:view" },
  { href: "/clients", label: "Clients", icon: Users, permission: "clients:view" },
  { href: "/buying-houses", label: "Buying Houses", icon: Building2, permission: "buying-houses:view" },
  { href: "/partners", label: "Partners", icon: Monitor, permission: "partners:view" },
  { href: "/purchase-orders", label: "Purchase Orders", icon: ClipboardList, permission: "purchase-orders:view" },
] as const;

const financialsItems = [
  { href: "/billings", label: "Billing", icon: FileText, permission: "billings:view" },
  { href: "/payments", label: "Payments", icon: CreditCard, permission: "payments:view" },
  { href: "/cost", label: "Cost", icon: DollarSign, permission: "cost:view" },
] as const;

const bottomNavItems = [
  { href: "/upload", label: "Upload Data", icon: Upload, permission: "upload:data" },
  { href: "/analytics", label: "Analytics", icon: BarChart3, permission: "analytics:view" },
  { href: "/settings", label: "Settings", icon: Settings, permission: "settings:view" },
] as const;
```

Replace the `useQuery(["roles"])` block and `canAccess` with:

```tsx
import { useUser, useLogout, useCan } from "@/lib/auth/user-context";
// ...
const user = useUser();
const logout = useLogout();
const can = useCan();
function canAccess(permission: string): boolean {
  return can(permission as import("@/lib/rbac/catalog").Permission);
}
```

> Settings nav gates on `settings:view` ("can open the Settings area at all"). The four `settings.*` sub-perms gate individual tabs inside the page (Task 16), so a user with `settings:view` + only `settings.catalogs:manage` reaches `/settings` and sees only the catalog tabs.

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc -p tsconfig.json --noEmit`
Expected: no errors in `Sidebar.tsx` (other files may error until Phase 3).

- [ ] **Step 3: Commit**

```bash
git add app/components/layout/Sidebar.tsx
git commit -m "feat(rbac): sidebar nav uses catalog keys + useCan"
```

---

## Phase 2 — Server-side enforcement (closes the security hole)

### Task 9: `requirePermission` guard

**Files:**
- Modify: `app/lib/auth/require.ts`
- Test: `app/lib/auth/require.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/lib/auth/require.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const getSession = vi.fn();
vi.mock("./session", () => ({ getSession }));
const getRolePermissions = vi.fn();
vi.mock("@/lib/rbac/role-permissions", () => ({ getRolePermissions }));

import { requirePermission, isAuthError } from "./require";

beforeEach(() => { getSession.mockReset(); getRolePermissions.mockReset(); });

describe("requirePermission", () => {
  it("401 when unauthenticated", async () => {
    getSession.mockResolvedValueOnce(null);
    const res = await requirePermission("clients:view");
    expect(isAuthError(res)).toBe(true);
    if (isAuthError(res)) expect(res.status).toBe(401);
  });

  it("403 when the role lacks the permission", async () => {
    getSession.mockResolvedValueOnce({ sub: 2, name: "V", email: "v@x.com", role: "Viewer", isSystem: false });
    getRolePermissions.mockResolvedValueOnce(["clients:view"]);
    const res = await requirePermission("clients:edit");
    expect(isAuthError(res)).toBe(true);
    if (isAuthError(res)) expect(res.status).toBe(403);
  });

  it("passes for a granted permission", async () => {
    getSession.mockResolvedValueOnce({ sub: 2, name: "V", email: "v@x.com", role: "Viewer", isSystem: false });
    getRolePermissions.mockResolvedValueOnce(["clients:view"]);
    const res = await requirePermission("clients:view");
    expect(isAuthError(res)).toBe(false);
  });

  it("passes for a system admin regardless of role perms", async () => {
    getSession.mockResolvedValueOnce({ sub: 1, name: "A", email: "a@x.com", role: "System Admin", isSystem: true });
    getRolePermissions.mockResolvedValueOnce([]);
    const res = await requirePermission("settings.roles:manage");
    expect(isAuthError(res)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/auth/require.test.ts`
Expected: FAIL — `requirePermission` not exported.

- [ ] **Step 3: Add `requirePermission` (keep existing exports)**

Append to `app/lib/auth/require.ts`:

```ts
import { getRolePermissions } from "@/lib/rbac/role-permissions";
import { effectivePermissions } from "@/lib/rbac/can";
import type { Permission } from "@/lib/rbac/catalog";

export async function requirePermission(perm: Permission): Promise<AuthResult> {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const rolePerms = await getRolePermissions(user.role);
  const eff = effectivePermissions({ role: user.role, isSystem: user.isSystem }, rolePerms);
  if (!eff.has(perm)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return { user };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run lib/auth/require.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/auth/require.ts app/lib/auth/require.test.ts
git commit -m "feat(rbac): requirePermission server guard"
```

---

### Task 10: Invalidate the resolver cache on role writes; lock `GET /api/roles`

**Files:**
- Modify: `app/app/api/roles/route.ts`
- Modify: `app/app/api/roles/[name]/route.ts`

- [ ] **Step 1: Lock `GET /api/roles` to `settings.roles:manage`**

In `app/app/api/roles/route.ts`, change the `GET` guard from `requireAuth` to `requirePermission`, and clear the cache after a successful `POST`:

```ts
import { requirePermission, isAuthError } from "@/lib/auth/require";
import { clearRolePermissionsCache } from "@/lib/rbac/role-permissions";

export async function GET(): Promise<Response> {
  const auth = await requirePermission("settings.roles:manage");
  if (isAuthError(auth)) return auth;
  // ...unchanged body...
}
```

At the end of the `POST` success paths (after update and after insert), call `clearRolePermissionsCache();` before returning.

- [ ] **Step 2: Clear cache on DELETE**

In `app/app/api/roles/[name]/route.ts`, after `await db.delete(...)`, add `clearRolePermissionsCache();` (import it).

- [ ] **Step 3: Typecheck + run existing roles tests**

Run: `pnpm exec tsc -p tsconfig.json --noEmit`
Run: `pnpm exec vitest run app/api/roles`
Expected: PASS / no new errors.

- [ ] **Step 4: Commit**

```bash
git add app/app/api/roles/route.ts app/app/api/roles/[name]/route.ts
git commit -m "feat(rbac): gate GET /api/roles + invalidate perm cache on role writes"
```

---

### Task 11: Route-guard coverage scanner (the completion gate for Task 12)

**Files:**
- Create: `app/lib/rbac/route-coverage.test.ts`

- [ ] **Step 1: Write the test that scans every route file**

```ts
// app/lib/rbac/route-coverage.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const apiDir = join(here, "..", "..", "app", "api");

// Routes that legitimately need no requirePermission guard.
// - public: healthz, login, logout
// - auth/me self-guards inline (getSession -> 401) and *returns* the permission
//   set that bootstraps the client, so it cannot require a specific permission.
const PUBLIC_ALLOWLIST = [
  "healthz/route.ts",
  "users/login/route.ts",
  "users/logout/route.ts",
  "auth/me/route.ts",
];

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function routeFiles(): string[] {
  // Node 22+ fs.globSync; if unavailable, swap for fast-glob.
  return globSync("**/route.ts", { cwd: apiDir }).map((p) => p.replace(/\\/g, "/"));
}

describe("every API route enforces authorization", () => {
  it("has a require* guard in each exported HTTP handler", () => {
    const offenders: string[] = [];
    for (const rel of routeFiles()) {
      if (PUBLIC_ALLOWLIST.includes(rel)) continue;
      const src = readFileSync(join(apiDir, rel), "utf8");
      const exportsHandler = HTTP_METHODS.some((m) =>
        new RegExp(`export async function ${m}\\b`).test(src),
      );
      if (!exportsHandler) continue;
      const guarded = /require(Auth|Admin|Permission)\s*\(/.test(src);
      if (!guarded) offenders.push(rel);
    }
    expect(offenders, `Unguarded routes:\n${offenders.join("\n")}`).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it — expect a long list of offenders (this is the Task 12 worklist)**

Run: `pnpm exec vitest run lib/rbac/route-coverage.test.ts`
Expected: FAIL, listing ~60 unguarded route files. Copy that list — it drives Task 12.

> If `fs.globSync` isn't available in this Node version, replace `globSync` import with `import { globSync } from "fast-glob"` after `pnpm add -D fast-glob -F @workspace/web`.

- [ ] **Step 3: Commit the scanner (still red)**

```bash
git add app/lib/rbac/route-coverage.test.ts
git commit -m "test(rbac): route-guard coverage scanner (currently red)"
```

---

### Task 12: Apply `requirePermission` to every route (drive to green)

**Files:** every file under `app/app/api/**/route.ts` except the allow-list and `auth/me`.

Apply this **pattern** to each handler, choosing the permission from the mapping table below. Repeat per file; the Task 11 scanner is the completion gate.

**Pattern** (example — clients list/create, `app/app/api/clients/route.ts`):

```ts
import { requirePermission, isAuthError } from "@/lib/auth/require";

export async function GET(): Promise<Response> {
  const auth = await requirePermission("clients:view");
  if (isAuthError(auth)) return auth;
  // ...existing body...
}

export async function POST(req: Request): Promise<Response> {
  const auth = await requirePermission("clients:edit");
  if (isAuthError(auth)) return auth;
  // ...existing body...
}
```

**Route → permission mapping** (GET = view unless noted):

| Route (under `app/app/api/`) | GET | POST / PUT / PATCH | DELETE |
|---|---|---|---|
| `clients/**`, `clients/[id]/**`, `clients/[id]/events/**` | `clients:view` | `clients:edit` | `clients:delete` |
| `clients/[id]/purchase-orders` | `purchase-orders:view` | `purchase-orders:edit` | — |
| `buying-houses/**` (+ `[id]/analytics`, `[id]/billing-records`) | `buying-houses:view` | `buying-houses:edit` | `buying-houses:delete` |
| `partners/**`, `partners/[id]/**`, `partners/[id]/clients/**` | `partners:view` | `partners:edit` | `partners:delete` |
| `partners/[id]/billing-records/**` | `billings:view` | `billings:edit` | `billings:edit` |
| `partners/[id]/payable-events`, `.../payout` | `payments:view` | `payments:edit` | — |
| `purchase-orders`, `client-purchase-orders/**`, `partner-purchase-orders/**` | `purchase-orders:view` | `purchase-orders:edit` | `purchase-orders:edit` |
| `*/status` under purchase orders | — | `purchase-orders:change-status` | — |
| `billings`, `billings/[id]`, `billings/[id]/invoice` (GET) | `billings:view` | `billings:edit` | `billings:edit` |
| `billings/[id]/invoice` (POST/generate) | — | `billings:generate-invoice` | — |
| `billings/[id]/status` | — | `billings:change-status` | — |
| `billing-records` | `billings:view` | `billings:edit` | `billings:edit` |
| `payments/**`, `payments/[id]` | `payments:view` | `payments:edit` | `payments:edit` |
| `payments/[id]/status` | — | `payments:change-status` | — |
| `partner-bills/**` | `billings:view` | `billings:edit` | `billings:edit` |
| `partner-payments/**` | `payments:view` | `payments:edit` | `payments:edit` |
| `partner-payments/[id]/status` | — | `partner-payments:change-status` | — |
| `cost-models/**`, `cost-resources/**` | `cost:view` | `cost:edit` | `cost:edit` |
| `payment-terms/**`, `tax-settings` | `settings.catalogs:manage` | `settings.catalogs:manage` | `settings.catalogs:manage` |
| `import/[type]` | — | `upload:data` | — |
| `uploads/po-attachment`, `uploads/payment-attachment` | — | `upload:data` | — |
| `analytics/**` (all) | `analytics:view` | `analytics:view` | — |
| `ai/chat` | keep existing `requireAuth` | — | — |
| `me/dashboard-layout` | keep existing `requireAuth` | `requireAuth` | — |
| `users/**` (list/create/[email]) | `settings.users:manage` | `settings.users:manage` | `settings.users:manage` |
| `roles/**` | `settings.roles:manage` (Task 10) | `settings.roles:manage` | `settings.roles:manage` |

> `tax-settings` GET is currently read by the Settings general tab; if a non-settings surface also needs it, widen its GET to also accept `settings.general:view`. For this pass, `settings.catalogs:manage` is correct because it's edited only from the catalogs area. Confirm during execution by grep-ing usages.

- [ ] **Step 1: Guard the routes, batch by module (clients, then buying-houses, then partners, …). Commit per module.**

Example commit after the clients batch:

```bash
git add app/app/api/clients
git commit -m "feat(rbac): enforce permissions on clients routes"
```

- [ ] **Step 2: Re-run the scanner after each batch**

Run: `pnpm exec vitest run lib/rbac/route-coverage.test.ts`
Expected: offender list shrinks each batch.

- [ ] **Step 3: Final — scanner green**

Run: `pnpm exec vitest run lib/rbac/route-coverage.test.ts`
Expected: PASS (offenders `[]`).

- [ ] **Step 4: Full test + typecheck**

Run: `pnpm exec vitest run` and `pnpm exec tsc -p tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 5: Final commit for the phase**

```bash
git add -A
git commit -m "feat(rbac): server-side permission enforcement across all API routes"
```

---

## Phase 3 — Tab & field gating in the UI

### Task 13: Client detail — gate tabs + bank/tax fields

**Files:**
- Modify: `app/app/(dashboard)/clients/[id]/page.tsx`
- Modify: `app/components/KycFields.tsx` (accept field-visibility props)

- [ ] **Step 1: Replace the hardcoded `<Tabs>` with `GatedTabs`**

In `ClientDetailPage`, swap the manual tabs (lines ~394-409) for:

```tsx
import { GatedTabs } from "@/components/rbac/GatedTabs";
import { CLIENT_DETAIL_TABS } from "@/lib/rbac/tabs";
// ...
<GatedTabs
  nodes={CLIENT_DETAIL_TABS}
  content={{
    details: <DetailsTab clientId={id} />,
    events: <EventsTab clientId={id} />,
    data: <DataTab clientId={id} />,
  }}
/>
```

- [ ] **Step 2: Update the two `useHasPermission("Edit Clients")` call sites to `useHasPermission("clients:edit")`** in `DetailsTab` and `EventsTab`.

- [ ] **Step 3: Gate bank/tax fields in the Details tab**

Pass visibility into `KycFields`:

```tsx
import { useCan } from "@/lib/auth/user-context";
// inside DetailsTab:
const can = useCan();
<KycFields
  value={kyc}
  onChange={setKyc}
  disabled={!canEdit}
  showBank={can("clients.bank:view")}
  showTax={can("clients.tax:view")}
/>
```

In `KycFields.tsx`, add optional props `showBank = true`, `showTax = true`, and wrap the bank-detail group and tax-number group in `{showBank && (...)}` / `{showTax && (...)}` respectively. (Grep the component for the bank and NTN/GST field blocks.)

- [ ] **Step 4: Typecheck + manual/verify**

Run: `pnpm exec tsc -p tsconfig.json --noEmit`
Expected: no errors in these files.

- [ ] **Step 5: Commit**

```bash
git add app/app/(dashboard)/clients/[id]/page.tsx app/components/KycFields.tsx
git commit -m "feat(rbac): gate client detail tabs + bank/tax fields"
```

---

### Task 14: Partner + Buying House detail — gate tabs & sensitive fields

**Files:**
- Modify: `app/app/(dashboard)/partners/[id]/page.tsx`
- Modify: `app/app/(dashboard)/partners/[id]/DetailsTab.tsx` (bank), `ClientsTab.tsx` (`Edit Partners` → `partners:edit`)
- Modify: `app/app/(dashboard)/buying-houses/[id]/page.tsx`

- [ ] **Step 1: Partner detail → `GatedTabs`**

```tsx
import { GatedTabs } from "@/components/rbac/GatedTabs";
import { PARTNER_DETAIL_TABS } from "@/lib/rbac/tabs";
// ...
<GatedTabs
  nodes={PARTNER_DETAIL_TABS}
  content={{
    details: <PartnerDetailsTab partner={partner} />,
    clients: <PartnerClientsTab partnerId={id} />,
    data: <PlatformDataTab platformId={id} platform={partner} />,
    analytics: <PlatformAnalyticsTab platformId={id} platform={partner} />,
  }}
/>
```

- [ ] **Step 2: Update `useHasPermission("Edit Partners")` → `"partners:edit"`** in `DetailsTab.tsx` and `ClientsTab.tsx`. Wrap partner bank fields in `DetailsTab.tsx` with `useCan("partners.bank:view")` and payout-rate fields with `useCan("partners.payout:view")`.

- [ ] **Step 3: Buying House detail → `GatedTabs`** using `BUYING_HOUSE_DETAIL_TABS`, mapping the existing tab contents by id. Update `useHasPermission("Edit Buying Houses")` → `"buying-houses:edit"`.

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm exec tsc -p tsconfig.json --noEmit
git add app/app/(dashboard)/partners app/app/(dashboard)/buying-houses
git commit -m "feat(rbac): gate partner & buying-house tabs and sensitive fields"
```

---

### Task 15: Billing (nested tabs) + Purchase Orders + list-page edit gates

**Files:**
- Modify: `app/app/(dashboard)/billings/page.tsx`
- Modify: `app/app/(dashboard)/purchase-orders/page.tsx`
- Modify: `app/app/(dashboard)/clients/page.tsx`, `partners/page.tsx`, `buying-houses/page.tsx` (update legacy `useHasPermission` strings)

- [ ] **Step 1: Billing page → nested `GatedTabs`**

Replace the manual nested tabs with:

```tsx
import { GatedTabs } from "@/components/rbac/GatedTabs";
import { BILLING_TABS } from "@/lib/rbac/tabs";
import { PermissionGuard } from "@/components/PermissionGuard";
import { ClientBillingSummaryTab } from "@/components/billings/ClientBillingSummaryTab";
import { ClientBillingDetailTab } from "@/components/billings/ClientBillingDetailTab";
import { PartnerBillingTab } from "@/components/billings/PartnerBillingTab";

export default function BillingPage() {
  return (
    <PermissionGuard permission="billings:view">
      <div className="space-y-4">
        <h1 className="text-xl font-bold">Billing</h1>
        <GatedTabs
          nodes={BILLING_TABS}
          content={{
            summary: <ClientBillingSummaryTab />,
            detail: <ClientBillingDetailTab />,
            partner: <PartnerBillingTab />,
          }}
        />
      </div>
    </PermissionGuard>
  );
}
```

> The `client` parent has no direct content — its children (`summary`, `detail`) render via the nested `GatedTabs`. Only leaf ids appear in `content`.

- [ ] **Step 2: Purchase Orders page → `GatedTabs`** using `PURCHASE_ORDER_TABS` mapping `clients: <ClientPOTab/>`, `partners: <PartnerPOTab/>`. Keep the outer `PermissionGuard permission="purchase-orders:view"`.

- [ ] **Step 3: Update legacy permission strings on list pages** — `PermissionGuard permission="View Clients"` → `"clients:view"`, `useHasPermission("Edit Clients")` → `"clients:edit"`, and the equivalents for partners/buying-houses/payments/cost/analytics/upload/transactions and the billing invoice page (`"View Billing Detail"` → `"billings.client.detail:view"`). Grep for the old strings:

Run: `grep -rn 'permission="View \|useHasPermission("View \|useHasPermission("Edit \|"Manage Settings"' app/app app/components`

Fix each to the catalog key.

- [ ] **Step 4: Typecheck (should now be clean everywhere)**

Run: `pnpm exec tsc -p tsconfig.json --noEmit`
Expected: PASS (no stale permission strings remain).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(rbac): nested billing tab gating + PO tabs + migrate legacy permission strings"
```

---

## Phase 4 — Grouped role editor & Settings tab gating

### Task 16: Settings page — gate tabs from the registry

**Files:**
- Modify: `app/app/(dashboard)/settings/page.tsx`

- [ ] **Step 1: Replace the page guard and tab bar**

- Change the page's outer guard from `<PermissionGuard permission="Manage Settings">` to `<PermissionGuard permission="settings:view">` (denies anyone who can't open Settings at all), then filter the tab bar with `visibleTabs(SETTINGS_TABS, can)` so each tab is independently gated by its `settings.*` sub-permission.

```tsx
import { useCan } from "@/lib/auth/user-context";
import { visibleTabs, SETTINGS_TABS } from "@/lib/rbac/tabs";
import { pickDefaultTab } from "@/components/rbac/GatedTabs";
// ...
const can = useCan();
const tabs = visibleTabs(SETTINGS_TABS, can);
const [activeTab, setActiveTab] = useState(() => pickDefaultTab(tabs) ?? "general");
```

Render the tab buttons from `tabs` instead of the hardcoded array (lines ~322-342). Keep the outer `<PermissionGuard permission="settings:view">` wrapping the whole return so a user without settings access is denied; a user with `settings:view` but no sub-tab perms will see the "No accessible sections." style empty state (render it when `tabs.length === 0`).

- [ ] **Step 2: Guard the Roles/Users mutating handlers behind their perms**

The Roles tab UI only renders when the user has `settings.roles:manage` (registry-driven), and the API is already locked (Task 10 + Task 12). No extra client logic needed beyond the tab gate.

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm exec tsc -p tsconfig.json --noEmit
git add app/app/(dashboard)/settings/page.tsx
git commit -m "feat(rbac): gate settings tabs via registry (split Manage Settings)"
```

---

### Task 17: Grouped, catalog-driven role editor

**Files:**
- Create: `app/components/settings/RolePermissionEditor.tsx`
- Test: `app/components/settings/role-editor-groups.test.ts`
- Modify: `app/app/(dashboard)/settings/page.tsx` (use the new editor; delete the local `ALL_PERMISSIONS`)

- [ ] **Step 1: Write the failing test for the grouping helper**

```ts
// app/components/settings/role-editor-groups.test.ts
import { describe, it, expect } from "vitest";
import { groupPermissions } from "./RolePermissionEditor";

describe("groupPermissions", () => {
  it("groups catalog entries by their group label", () => {
    const groups = groupPermissions();
    const names = groups.map((g) => g.group);
    expect(names).toContain("Clients");
    expect(names).toContain("Settings");
  });
  it("Clients group contains view/edit/delete + tabs + fields", () => {
    const groups = groupPermissions();
    const clients = groups.find((g) => g.group === "Clients")!;
    const keys = clients.items.map((i) => i.key);
    expect(keys).toEqual(expect.arrayContaining([
      "clients:view", "clients:edit", "clients:delete",
      "clients.data:view", "clients.bank:view",
    ]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run components/settings/role-editor-groups.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Build the editor + grouping helper**

```tsx
// app/components/settings/RolePermissionEditor.tsx
"use client";

import { PERMISSIONS, type Permission, type PermissionDef } from "@/lib/rbac/catalog";

export interface PermissionGroup {
  group: string;
  items: PermissionDef[];
}

export function groupPermissions(): PermissionGroup[] {
  const map = new Map<string, PermissionDef[]>();
  for (const p of PERMISSIONS) {
    if (!map.has(p.group)) map.set(p.group, []);
    map.get(p.group)!.push(p);
  }
  return [...map.entries()].map(([group, items]) => ({ group, items }));
}

const KIND_BADGE: Record<PermissionDef["kind"], string> = {
  action: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
  tab: "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  field: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  workflow: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
};

export function RolePermissionEditor({
  selected,
  onToggle,
  onToggleGroup,
}: {
  selected: string[];
  onToggle: (key: Permission) => void;
  onToggleGroup: (keys: Permission[], allOn: boolean) => void;
}) {
  const groups = groupPermissions();
  const set = new Set(selected);
  return (
    <div className="space-y-4 max-h-[28rem] overflow-y-auto pr-1">
      {groups.map((g) => {
        const keys = g.items.map((i) => i.key as Permission);
        const allOn = keys.every((k) => set.has(k));
        return (
          <div key={g.group} className="rounded-xl border border-border p-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{g.group}</h4>
              <button
                type="button"
                className="text-[11px] font-medium text-violet-600 hover:underline"
                onClick={() => onToggleGroup(keys, !allOn)}
              >
                {allOn ? "Clear all" : "Select all"}
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {g.items.map((p) => (
                <label key={p.key} className="flex items-center gap-2 text-xs cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={set.has(p.key)}
                    onChange={() => onToggle(p.key as Permission)}
                    className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                  />
                  <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${KIND_BADGE[p.kind]}`}>
                    {p.kind}
                  </span>
                  <span className="text-foreground">{p.label}</span>
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Wire it into the Settings role dialog**

In `app/app/(dashboard)/settings/page.tsx`:
- Delete the local `ALL_PERMISSIONS` array (lines ~21-33) and the inline checkbox grid in the role dialog.
- Replace the checkbox grid with:

```tsx
import { RolePermissionEditor } from "@/components/settings/RolePermissionEditor";
import type { Permission } from "@/lib/rbac/catalog";
// ...
<RolePermissionEditor
  selected={selectedPermissions}
  onToggle={(key) =>
    setSelectedPermissions((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key],
    )
  }
  onToggleGroup={(keys, allOn) =>
    setSelectedPermissions((prev) => {
      const s = new Set(prev);
      keys.forEach((k) => (allOn ? s.add(k) : s.delete(k)));
      return [...s];
    })
  }
/>
```
- Update the "All Rights Enabled" comparison to use `ALL_PERMISSIONS.length` from `@/lib/rbac/catalog`.

- [ ] **Step 5: Run test + typecheck**

Run: `pnpm exec vitest run components/settings/role-editor-groups.test.ts`
Run: `pnpm exec tsc -p tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/components/settings/RolePermissionEditor.tsx app/components/settings/role-editor-groups.test.ts app/app/(dashboard)/settings/page.tsx
git commit -m "feat(rbac): catalog-driven grouped role editor (fixes missing-permissions bug)"
```

---

## Phase 5 — Migration & seed

### Task 18: Old→new permission mapping (pure function + test)

**Files:**
- Create: `app/lib/rbac/migrate-permissions.ts`
- Test: `app/lib/rbac/migrate-permissions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/lib/rbac/migrate-permissions.test.ts
import { describe, it, expect } from "vitest";
import { migratePermissions } from "./migrate-permissions";
import { ALL_PERMISSIONS } from "./catalog";

describe("migratePermissions", () => {
  it("expands View Clients into module + tabs + fields (no behavior loss)", () => {
    const out = migratePermissions(["View Clients"]);
    expect(out).toEqual(expect.arrayContaining([
      "clients:view", "clients.details:view", "clients.events:view",
      "clients.data:view", "clients.bank:view", "clients.tax:view",
    ]));
    expect(out).not.toContain("clients:delete"); // delete stays off
  });

  it("splits Manage Settings into settings:view + the four sub-perms", () => {
    const out = migratePermissions(["Manage Settings"]);
    expect(out).toEqual(expect.arrayContaining([
      "settings:view", "settings.general:view", "settings.roles:manage",
      "settings.users:manage", "settings.catalogs:manage",
    ]));
  });

  it("maps View Billing Detail to the nested client detail tab", () => {
    expect(migratePermissions(["View Billing Detail"])).toContain("billings.client.detail:view");
  });

  it("drops legacy View Transactions and produces only catalog keys", () => {
    const out = migratePermissions(["View Transactions", "View Clients"]);
    const valid = new Set(ALL_PERMISSIONS);
    for (const k of out) expect(valid.has(k)).toBe(true);
  });

  it("dedupes", () => {
    const out = migratePermissions(["View Clients", "View Clients"]);
    expect(new Set(out).size).toBe(out.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run lib/rbac/migrate-permissions.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the mapping**

```ts
// app/lib/rbac/migrate-permissions.ts
import type { Permission } from "./catalog";

const MAP: Record<string, Permission[]> = {
  "View Dashboard": ["dashboard:view"],
  "View Clients": [
    "clients:view", "clients.details:view", "clients.events:view",
    "clients.data:view", "clients.bank:view", "clients.tax:view",
  ],
  "Edit Clients": ["clients:edit"],
  "View Partners": [
    "partners:view", "partners.details:view", "partners.clients:view",
    "partners.data:view", "partners.analytics:view", "partners.bank:view", "partners.payout:view",
  ],
  "Edit Partners": ["partners:edit"],
  "View Buying Houses": [
    "buying-houses:view", "buying-houses.details:view",
    "buying-houses.data:view", "buying-houses.analytics:view",
  ],
  "Edit Buying Houses": ["buying-houses:edit"],
  "View Purchase Orders": [
    "purchase-orders:view", "purchase-orders.clients:view", "purchase-orders.partners:view",
  ],
  "Edit Purchase Orders": ["purchase-orders:edit", "purchase-orders:change-status"],
  "View Billings": [
    "billings:view", "billings.client:view", "billings.client.summary:view",
    "billings.partner:view", "billings.margin:view",
  ],
  "View Billing Detail": ["billings.client.detail:view"],
  "View Payments": ["payments:view"],
  "View Cost": ["cost:view"],
  "View Analytics": ["analytics:view"],
  "Upload Data": ["upload:data"],
  "Manage Settings": [
    "settings:view", "settings.general:view", "settings.roles:manage",
    "settings.users:manage", "settings.catalogs:manage",
  ],
  "View Transactions": [], // legacy media model retired
};

export function migratePermissions(old: string[]): string[] {
  const out = new Set<string>();
  for (const key of old) {
    const mapped = MAP[key];
    if (mapped) mapped.forEach((k) => out.add(k));
  }
  return [...out];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run lib/rbac/migrate-permissions.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/rbac/migrate-permissions.ts app/lib/rbac/migrate-permissions.test.ts
git commit -m "feat(rbac): old->new permission migration mapping"
```

---

### Task 19: Migration script for existing roles

**Files:**
- Create: `app/scripts/migrate-rbac.ts`

- [ ] **Step 1: Write the script**

```ts
// app/scripts/migrate-rbac.ts
import { db, rolesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { migratePermissions } from "@/lib/rbac/migrate-permissions";

async function run() {
  const roles = await db.select().from(rolesTable);
  for (const role of roles) {
    if (role.isSystem) continue; // system roles are reset by seed
    const looksLegacy = role.permissions.some((p) => p.includes(" ")); // legacy strings contain spaces
    if (!looksLegacy) {
      console.log(`[migrate-rbac] skip ${role.name} (already migrated)`);
      continue;
    }
    const next = migratePermissions(role.permissions);
    await db.update(rolesTable).set({ permissions: next }).where(eq(rolesTable.name, role.name));
    console.log(`[migrate-rbac] ${role.name}: ${role.permissions.length} -> ${next.length} perms`);
  }
  console.log("[migrate-rbac] done");
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

> `@/` path alias must resolve under `tsx`. If it doesn't, use a relative import `../lib/rbac/migrate-permissions`.

- [ ] **Step 2: Add an npm script**

In `app/package.json` scripts, add: `"db:migrate-rbac": "tsx scripts/migrate-rbac.ts"`.

- [ ] **Step 3: Dry-run against a dev DB (manual)**

Run: `pnpm -F @workspace/web db:migrate-rbac`
Expected: log lines showing each custom role's perm count change; system roles skipped.

- [ ] **Step 4: Commit**

```bash
git add app/scripts/migrate-rbac.ts app/package.json
git commit -m "feat(rbac): one-time migration script for custom roles"
```

---

### Task 20: Rewrite seed `DEFAULT_ROLES` to catalog keys

**Files:**
- Modify: `app/scripts/seed.ts:5-40`

- [ ] **Step 1: Replace `DEFAULT_ROLES`**

```ts
import { ALL_PERMISSIONS } from "@/lib/rbac/catalog";

const OPERATOR_PERMS = ALL_PERMISSIONS.filter(
  (p) => p !== "settings.roles:manage" && p !== "settings.users:manage"
    && !p.endsWith(":delete"),
);

const VIEWER_PERMS = ALL_PERMISSIONS.filter(
  (p) => p.endsWith(":view")
    && !p.startsWith("settings") // excludes settings:view AND settings.* (viewers get no settings access)
    && p !== "analytics:export",
);

const DEFAULT_ROLES = [
  { name: "System Admin", permissions: [...ALL_PERMISSIONS], isSystem: true },
  { name: "Operator", permissions: OPERATOR_PERMS, isSystem: true },
  { name: "Viewer", permissions: VIEWER_PERMS, isSystem: true },
];
```

> `Viewer` gets every `:view` (module + tab + sensitive-field views) but no `:edit`, workflow, delete, or settings management — matching the spec's "no day-one change; tighten later". `Operator` gets everything except role/user management and deletes.

- [ ] **Step 2: Run the seed against a dev DB (manual)**

Run: `pnpm -F @workspace/web db:seed`
Expected: system roles updated to catalog keys; default admin unchanged.

- [ ] **Step 3: Full test suite + typecheck**

Run: `pnpm exec vitest run` and `pnpm exec tsc -p tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/scripts/seed.ts
git commit -m "feat(rbac): seed default roles from catalog keys"
```

---

## Final verification

- [ ] **Full suite green:** `pnpm exec vitest run` (from `app/`) — all tests pass, including `route-coverage.test.ts`.
- [ ] **Typecheck clean:** `pnpm exec tsc -p tsconfig.json --noEmit` — zero errors (proves no stale permission strings remain).
- [ ] **Manual smoke (dev):** log in as `Viewer` → confirm no Edit buttons, no client Data tab if that perm is removed, `403` from `curl -X POST /api/clients` with a Viewer cookie. Log in as `System Admin` → everything visible.
- [ ] **Migration verified:** run `db:migrate-rbac` then `db:seed` on a copy of prod data; spot-check a custom role in Settings → Roles & Rights shows migrated permissions with no blanks.

---

## Notes / deferred

- **Partner billing Summary/Detail split** is not built here. When it is, add `billings.partner.summary:view` / `billings.partner.detail:view` to `catalog.ts`, nest them under `billings.partner:view` in `BILLING_TABS`, and extend `migratePermissions` (`View Billings` → also add `billings.partner.summary:view`).
- **Middleware** remains authentication-only by design; authorization is enforced per-route (server) so page routes and API share one model. No change needed.
- **`analytics:export`** starts off for all non-admin roles; wire an actual export action to it when analytics export ships.