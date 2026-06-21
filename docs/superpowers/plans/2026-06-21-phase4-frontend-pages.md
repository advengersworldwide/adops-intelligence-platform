# Phase 4: Frontend Pages Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port all 14 Vite SPA pages and layout components into Next.js 15 App Router under `artifacts/web/`, replacing the placeholder dashboard and delivering a fully functional single-deployment frontend.

**Architecture:** Copy-and-adapt strategy — every Vite page becomes a `"use client"` Next.js page under `app/(dashboard)/`. Auth moves from localStorage JWT to a `UserProvider` context backed by `GET /api/auth/me`. Layout components are copied and adapted (wouter → next/navigation, auth calls → hooks).

**Tech Stack:** Next.js 15 App Router, TanStack Query v5, next-themes, react-grid-layout, recharts, shadcn/ui, @workspace/api-client-react

**Worktree:** `e:\Futurama Projects\adops-intelligence-platform\.worktrees\feat-nextjs-migration\`
**All work under:** `artifacts/web/`
**Source to read (do not modify):** `artifacts/adops/src/`

---

### Task 1: Install Dependencies and Copy Base Utilities

**Files:**
- Modify: `artifacts/web/package.json`
- Create: `artifacts/web/lib/utils.ts`
- Create: `artifacts/web/hooks/use-mobile.tsx`

- [ ] **Step 1: Add missing npm packages**

In `artifacts/web/`, run:
```bash
pnpm add react-grid-layout recharts react-resizable
```

- [ ] **Step 2: Verify packages installed**

```bash
pnpm list react-grid-layout recharts react-resizable
```
Expected: all three listed with version numbers.

- [ ] **Step 3: Create lib/utils.ts**

Create `artifacts/web/lib/utils.ts`:
```typescript
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 4: Create hooks/use-mobile.tsx**

Copy `artifacts/adops/src/hooks/use-mobile.tsx` verbatim to `artifacts/web/hooks/use-mobile.tsx`. No changes needed.

- [ ] **Step 5: Run typecheck**

```bash
cd artifacts/web && pnpm typecheck
```
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add artifacts/web/package.json artifacts/web/pnpm-lock.yaml artifacts/web/lib/utils.ts artifacts/web/hooks/use-mobile.tsx
git commit -m "feat(web): add recharts/react-grid-layout deps and base utilities"
```

---

### Task 2: Copy UI Components Wholesale

**Files:**
- Create: `artifacts/web/components/ui/` (40+ files, copied verbatim)

All shadcn UI components are self-contained React with no router or auth dependencies. Copy them all without modification.

- [ ] **Step 1: Copy all UI components**

```bash
cp -r artifacts/adops/src/components/ui/. artifacts/web/components/ui/
```

On Windows PowerShell use:
```powershell
Copy-Item -Path "artifacts\adops\src\components\ui\*" -Destination "artifacts\web\components\ui\" -Recurse -Force
```

- [ ] **Step 2: Run typecheck**

```bash
cd artifacts/web && pnpm typecheck
```
Expected: zero errors. If any errors reference missing packages (e.g., `vaul`, `cmdk`, `input-otp`), install them:
```bash
pnpm add vaul cmdk input-otp @radix-ui/react-accordion @radix-ui/react-alert-dialog @radix-ui/react-avatar @radix-ui/react-checkbox @radix-ui/react-collapsible @radix-ui/react-context-menu @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-hover-card @radix-ui/react-label @radix-ui/react-menubar @radix-ui/react-navigation-menu @radix-ui/react-popover @radix-ui/react-progress @radix-ui/react-radio-group @radix-ui/react-scroll-area @radix-ui/react-select @radix-ui/react-separator @radix-ui/react-slider @radix-ui/react-switch @radix-ui/react-tabs @radix-ui/react-toggle @radix-ui/react-toggle-group
```
Re-run typecheck until clean.

- [ ] **Step 3: Commit**

```bash
git add artifacts/web/components/ui/
git commit -m "feat(web): copy shadcn UI components from Vite SPA"
```

---

### Task 3: Create GET /api/auth/me Route

**Files:**
- Create: `artifacts/web/app/api/auth/me/route.ts`

- [ ] **Step 1: Create the route handler**

Create `artifacts/web/app/api/auth/me/route.ts`:
```typescript
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  return NextResponse.json({
    id: user.sub,
    name: user.name,
    email: user.email,
    role: user.role,
    isSystem: user.isSystem ?? false,
  });
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd artifacts/web && pnpm typecheck
```
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add artifacts/web/app/api/auth/me/route.ts
git commit -m "feat(web): add GET /api/auth/me session endpoint"
```

---

### Task 4: Create UserProvider and Auth Hooks

**Files:**
- Create: `artifacts/web/lib/auth/user-context.tsx`

This replaces `artifacts/adops/src/lib/auth.ts`. The Vite SPA reads user from `localStorage`; in Next.js, we fetch from `/api/auth/me` once and cache it forever via TanStack Query.

- [ ] **Step 1: Create lib/auth/user-context.tsx**

Create `artifacts/web/lib/auth/user-context.tsx`:
```typescript
"use client";

import { createContext, useContext } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  role: string;
  isSystem: boolean;
}

interface Role {
  name: string;
  permissions: string[];
  isSystem?: boolean;
}

interface UserContextValue {
  user: SessionUser | null;
  isLoading: boolean;
}

const UserContext = createContext<UserContextValue>({ user: null, isLoading: true });

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

  return (
    <UserContext.Provider value={{ user, isLoading }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser(): SessionUser | null {
  return useContext(UserContext).user;
}

export function useHasPermission(permission: string): boolean | null {
  const { user, isLoading } = useContext(UserContext);

  const { data: roles } = useQuery<Role[]>({
    queryKey: ["roles"],
    queryFn: () => fetch("/api/roles").then(r => r.json()),
    staleTime: Infinity,
    enabled: !!user && user.role !== "System Admin" && !user.isSystem,
  });

  if (isLoading) return null;
  if (!user) return false;
  if (user.role === "System Admin" || user.isSystem) return true;
  if (!roles) return null; // roles still loading
  const userRole = roles.find(r => r.name.toLowerCase() === user.role.toLowerCase());
  return userRole?.permissions.includes(permission) ?? false;
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

- [ ] **Step 2: Run typecheck**

```bash
cd artifacts/web && pnpm typecheck
```
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add artifacts/web/lib/auth/user-context.tsx
git commit -m "feat(web): add UserProvider and auth hooks (useUser, useHasPermission, useLogout)"
```

---

### Task 5: Create PermissionGuard Component

**Files:**
- Create: `artifacts/web/components/PermissionGuard.tsx`

- [ ] **Step 1: Create PermissionGuard.tsx**

Create `artifacts/web/components/PermissionGuard.tsx`:
```typescript
"use client";

import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useHasPermission } from "@/lib/auth/user-context";

function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6 space-y-4">
      <div className="rounded-full bg-red-50 dark:bg-red-950/30 p-4 text-red-600 dark:text-red-400">
        <ShieldAlert className="h-12 w-12 animate-pulse" />
      </div>
      <h2 className="text-xl font-bold text-foreground">Access Denied</h2>
      <p className="text-sm text-muted-foreground max-w-sm">
        Your account role does not have the permissions required to access this module. Please contact your system administrator.
      </p>
      <Link href="/">
        <Button variant="outline" className="mt-2 text-xs">
          Return to Dashboard
        </Button>
      </Link>
    </div>
  );
}

export function PermissionGuard({
  permission,
  children,
}: {
  permission: string;
  children: React.ReactNode;
}) {
  const allowed = useHasPermission(permission);

  if (allowed === null) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!allowed) return <AccessDenied />;
  return <>{children}</>;
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd artifacts/web && pnpm typecheck
```
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add artifacts/web/components/PermissionGuard.tsx
git commit -m "feat(web): add PermissionGuard component"
```

---

### Task 6: Update providers.tsx to Include UserProvider

**Files:**
- Modify: `artifacts/web/app/providers.tsx`

- [ ] **Step 1: Read current providers.tsx**

Read `artifacts/web/app/providers.tsx` (should match what was set up in Phase 1+2 — QueryClient, ThemeProvider, TooltipProvider, Toaster).

- [ ] **Step 2: Add UserProvider**

Update `artifacts/web/app/providers.tsx` to add `UserProvider` inside the QueryClientProvider (so it has access to TanStack Query):
```typescript
"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Toaster } from "sonner";
import { UserProvider } from "@/lib/auth/user-context";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1 },
        },
      }),
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <QueryClientProvider client={queryClient}>
        <UserProvider>
          <TooltipPrimitive.Provider>
            {children}
            <Toaster richColors closeButton />
          </TooltipPrimitive.Provider>
        </UserProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
```

- [ ] **Step 3: Run typecheck**

```bash
cd artifacts/web && pnpm typecheck
```
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add artifacts/web/app/providers.tsx
git commit -m "feat(web): add UserProvider to app providers"
```

---

### Task 7: Create Adapted Layout Components

**Files:**
- Create: `artifacts/web/components/layout/Layout.tsx`
- Create: `artifacts/web/components/layout/Sidebar.tsx`
- Create: `artifacts/web/components/layout/Topbar.tsx`

Key changes from source for all layout files:
- Add `"use client"` as first line
- `import { Link, useLocation } from "wouter"` → `import Link from "next/link"` + `import { usePathname } from "next/navigation"`
- `const [location] = useLocation()` → `const pathname = usePathname()`
- All `location` references → `pathname`
- `getCurrentUser()` → `useUser()`
- `hasPermission(p)` → `useHasPermission(p)`
- `logout()` → `const logout = useLogout()` at top of component, then call `logout()`
- `import { ... } from "@/lib/auth"` → `import { useUser, useHasPermission, useLogout } from "@/lib/auth/user-context"`
- `import { useTheme } from "@/components/theme-provider"` → `import { useTheme } from "next-themes"`

- [ ] **Step 1: Create Layout.tsx**

Copy `artifacts/adops/src/components/layout/Layout.tsx` to `artifacts/web/components/layout/Layout.tsx` and add `"use client"` as the first line. No other changes needed (no auth or router calls in Layout.tsx).

```typescript
"use client";

import { useState, useEffect } from "react";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import FloatingChat from "../FloatingChat";

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setSidebarOpen(false);
      } else {
        setSidebarOpen(true);
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden backdrop-blur-xs transition-opacity cursor-pointer"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <Sidebar open={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
      <FloatingChat />
    </div>
  );
}
```

- [ ] **Step 2: Create Sidebar.tsx**

Copy `artifacts/adops/src/components/layout/Sidebar.tsx` to `artifacts/web/components/layout/Sidebar.tsx`. Apply these changes:

1. Add `"use client";` as first line
2. Replace: `import { Link, useLocation } from "wouter";`
   With:
   ```typescript
   import Link from "next/link";
   import { usePathname } from "next/navigation";
   ```
3. Replace: `import { getCurrentUser, hasPermission, logout } from "@/lib/auth";`
   With:
   ```typescript
   import { useUser, useHasPermission, useLogout } from "@/lib/auth/user-context";
   ```
4. Inside the `Sidebar` component function, replace:
   ```typescript
   const [location] = useLocation();
   ```
   With:
   ```typescript
   const pathname = usePathname();
   const logout = useLogout();
   ```
5. Replace all occurrences of `location` with `pathname` in the component body.
6. Replace `const user = getCurrentUser();` with `const user = useUser();`
7. In the `renderItem` function, replace `hasPermission(permission)` with `useHasPermission(permission)`. Because hooks cannot be called inside a nested function (`renderItem`), extract the permission checks at the top level: move rendering logic so `useHasPermission` is not called inside `renderItem`. Instead, filter the nav items before rendering:

Replace the `renderItem` helper with an inline approach that passes `allowed` as a prop, or simply do permission checks at the map level. The simplest correct approach:

```typescript
// Remove renderItem helper. Instead filter then map:
const visibleTopItems = topNavItems.filter(item => {
  const user_ = user;
  if (!user_) return false;
  if (user_.role === "System Admin" || user_.isSystem) return true;
  return false; // will be fixed in step below
});
```

Actually since `useHasPermission` is a hook and can't be called conditionally inside map, use a different approach — pass the full user + roles down. Read the roles query result directly:

Replace `hasPermission(item.permission)` calls in `renderItem` and `hasAnyFinancials`/`isFinancialsActive` checks with a simple synchronous check using the user object and a locally fetched roles list:

```typescript
import { useUser, useLogout } from "@/lib/auth/user-context";
import { useQuery } from "@tanstack/react-query";

// Inside Sidebar component:
const user = useUser();
const logout = useLogout();
const pathname = usePathname();
const { data: roles = [] } = useQuery({
  queryKey: ["roles"],
  queryFn: () => fetch("/api/roles").then(r => r.json()),
  staleTime: Infinity,
  enabled: !!user && user.role !== "System Admin" && !user.isSystem,
});

function canAccess(permission: string): boolean {
  if (!user) return false;
  if (user.role === "System Admin" || user.isSystem) return true;
  const userRole = roles.find((r: { name: string; permissions: string[] }) =>
    r.name.toLowerCase() === user.role.toLowerCase()
  );
  return userRole?.permissions.includes(permission) ?? false;
}
```

Then replace all `hasPermission(item.permission)` → `canAccess(item.permission)`.
Replace `logout` call → `void logout()`.

8. In `renderItem`, replace:
   ```typescript
   const isActive = href === "/" ? location === "/" : location.startsWith(href);
   ```
   With:
   ```typescript
   const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);
   ```

- [ ] **Step 3: Create Topbar.tsx**

Copy `artifacts/adops/src/components/layout/Topbar.tsx` to `artifacts/web/components/layout/Topbar.tsx`. Apply these changes:

1. Add `"use client";` as first line
2. Replace: `import { useTheme } from "@/components/theme-provider";`
   With: `import { useTheme } from "next-themes";`
3. Replace: `import { getCurrentUser, logout } from "@/lib/auth";`
   With: `import { useUser, useLogout } from "@/lib/auth/user-context";`
4. Inside the `Topbar` component, replace:
   ```typescript
   const user = getCurrentUser();
   ```
   With:
   ```typescript
   const user = useUser();
   const logout = useLogout();
   ```
5. In the logout button `onClick`, replace `logout()` with `void logout()`.

- [ ] **Step 4: Run typecheck**

```bash
cd artifacts/web && pnpm typecheck
```
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add artifacts/web/components/layout/
git commit -m "feat(web): add Layout, Sidebar, Topbar components adapted for Next.js"
```

---

### Task 8: Copy FloatingChat and KycFields

**Files:**
- Create: `artifacts/web/components/FloatingChat.tsx`
- Create: `artifacts/web/components/KycFields.tsx`

- [ ] **Step 1: Create FloatingChat.tsx**

Copy `artifacts/adops/src/components/FloatingChat.tsx` to `artifacts/web/components/FloatingChat.tsx`. Apply these changes:

1. Add `"use client";` as first line
2. Remove: `import { getToken } from "@/lib/auth";`
3. In the `send` function, remove the `Authorization` header from the fetch call. Replace:
   ```typescript
   headers: {
     "Content-Type": "application/json",
     Authorization: `Bearer ${getToken() ?? ""}`,
   },
   ```
   With:
   ```typescript
   headers: {
     "Content-Type": "application/json",
   },
   ```
   (Cookies are sent automatically on same-origin requests — no auth header needed.)

- [ ] **Step 2: Copy KycFields.tsx**

Copy `artifacts/adops/src/components/KycFields.tsx` to `artifacts/web/components/KycFields.tsx`. Add `"use client";` as first line if it uses browser APIs or hooks (check source). No other changes.

- [ ] **Step 3: Run typecheck**

```bash
cd artifacts/web && pnpm typecheck
```
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add artifacts/web/components/FloatingChat.tsx artifacts/web/components/KycFields.tsx
git commit -m "feat(web): add FloatingChat and KycFields components"
```

---

### Task 9: Create (dashboard) Layout and Route Structure

**Files:**
- Create: `artifacts/web/app/(dashboard)/layout.tsx`
- Create: `artifacts/web/app/not-found.tsx`

- [ ] **Step 1: Create (dashboard)/layout.tsx**

Create `artifacts/web/app/(dashboard)/layout.tsx`:
```typescript
import Layout from "@/components/layout/Layout";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Layout>{children}</Layout>;
}
```

This is a server component (no `"use client"`). The middleware from Phase 1+2 already redirects unauthenticated users to `/login` before this layout renders.

- [ ] **Step 2: Create app/not-found.tsx**

Copy `artifacts/adops/src/pages/not-found.tsx` to `artifacts/web/app/not-found.tsx`. Add `"use client";` as first line. Replace any wouter `Link` or `useLocation` with `next/link`. This file must export a default function named `NotFound`.

- [ ] **Step 3: Run typecheck**

```bash
cd artifacts/web && pnpm typecheck
```
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add artifacts/web/app/(dashboard)/layout.tsx artifacts/web/app/not-found.tsx
git commit -m "feat(web): add dashboard layout shell and not-found page"
```

---

### Task 10: Port Dashboard Page

**Files:**
- Modify: `artifacts/web/app/(dashboard)/page.tsx` (replace Phase 1+2 placeholder)

The Dashboard page uses `react-grid-layout` for a draggable widget system and `recharts` for charts. It already reads from `@workspace/api-client-react` hooks.

- [ ] **Step 1: Replace the placeholder dashboard page**

Copy `artifacts/adops/src/pages/Dashboard.tsx` to `artifacts/web/app/(dashboard)/page.tsx`. Apply these changes:

1. Add `"use client";` as first line
2. Add `PermissionGuard` wrapper. Wrap the returned JSX with:
   ```typescript
   import { PermissionGuard } from "@/components/PermissionGuard";
   // ...
   return <PermissionGuard permission="View Dashboard"><DashboardContent /></PermissionGuard>;
   ```
   Extract the existing JSX into an inner `DashboardContent` component, or wrap at the top level.
3. Remove any wouter imports (Dashboard.tsx should not have any — verify).
4. Keep all `@workspace/api-client-react` hook imports unchanged.
5. The `import "react-grid-layout/css/styles.css"` and `import "react-resizable/css/styles.css"` lines are fine — Next.js supports CSS imports in `"use client"` components.

- [ ] **Step 2: Run typecheck**

```bash
cd artifacts/web && pnpm typecheck
```
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add artifacts/web/app/(dashboard)/page.tsx
git commit -m "feat(web): port Dashboard page"
```

---

### Task 11: Port Clients Pages

**Files:**
- Create: `artifacts/web/app/(dashboard)/clients/page.tsx`
- Create: `artifacts/web/app/(dashboard)/clients/[id]/page.tsx`

- [ ] **Step 1: Create clients/page.tsx**

Copy `artifacts/adops/src/pages/Clients.tsx` to `artifacts/web/app/(dashboard)/clients/page.tsx`. Apply:
1. Add `"use client";` as first line
2. Add import: `import { PermissionGuard } from "@/components/PermissionGuard";`
3. Wrap top-level return with `<PermissionGuard permission="View Clients">...</PermissionGuard>`
4. Remove any wouter imports. Replace `import { Link } from "wouter"` with `import Link from "next/link"`. Replace `import { useLocation } from "wouter"` with `import { usePathname } from "next/navigation"` and `location` with `pathname` if present.

- [ ] **Step 2: Create clients/[id]/page.tsx**

The Vite route passes `id` as a prop: `<ClientDetailPage id={parseInt(params.id!, 10)} />`. In Next.js, params come from `useParams()`.

Create `artifacts/web/app/(dashboard)/clients/[id]/page.tsx`:
```typescript
"use client";

import { useParams } from "next/navigation";
import { PermissionGuard } from "@/components/PermissionGuard";
// Copy the entire body of artifacts/adops/src/pages/ClientDetail.tsx here,
// but rename the export to ClientDetailPage and extract it as an inner component.

// Then the default export wraps it:
export default function ClientDetailRoute() {
  const { id } = useParams<{ id: string }>();
  return (
    <PermissionGuard permission="View Clients">
      <ClientDetailPage id={parseInt(id, 10)} />
    </PermissionGuard>
  );
}
```

Copy the full content of `artifacts/adops/src/pages/ClientDetail.tsx` into this file, rename the exported function to `ClientDetailPage`, make it accept `{ id: number }` props, and add the wrapper above as the default export. Remove any wouter imports.

- [ ] **Step 3: Run typecheck**

```bash
cd artifacts/web && pnpm typecheck
```
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add artifacts/web/app/(dashboard)/clients/
git commit -m "feat(web): port Clients and ClientDetail pages"
```

---

### Task 12: Port BuyingHouses Pages

**Files:**
- Create: `artifacts/web/app/(dashboard)/buying-houses/page.tsx`
- Create: `artifacts/web/app/(dashboard)/buying-houses/[id]/page.tsx`

- [ ] **Step 1: Create buying-houses/page.tsx**

Copy `artifacts/adops/src/pages/BuyingHouses.tsx` to `artifacts/web/app/(dashboard)/buying-houses/page.tsx`. Apply:
1. Add `"use client";` as first line
2. Wrap with `<PermissionGuard permission="View Buying Houses">...</PermissionGuard>`
3. Replace wouter `Link`/`useLocation` with next/link and next/navigation

- [ ] **Step 2: Create buying-houses/[id]/page.tsx**

Create `artifacts/web/app/(dashboard)/buying-houses/[id]/page.tsx`:
```typescript
"use client";

import { useParams } from "next/navigation";
import { PermissionGuard } from "@/components/PermissionGuard";
// Paste full content of artifacts/adops/src/pages/BuyingHouseDetail.tsx here,
// rename export to BuyingHouseDetailPage accepting { id: number } prop.

export default function BuyingHouseDetailRoute() {
  const { id } = useParams<{ id: string }>();
  return (
    <PermissionGuard permission="View Buying Houses">
      <BuyingHouseDetailPage id={parseInt(id, 10)} />
    </PermissionGuard>
  );
}
```

- [ ] **Step 3: Run typecheck**

```bash
cd artifacts/web && pnpm typecheck
```
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add artifacts/web/app/(dashboard)/buying-houses/
git commit -m "feat(web): port BuyingHouses and BuyingHouseDetail pages"
```

---

### Task 13: Port Partners Pages

**Files:**
- Create: `artifacts/web/app/(dashboard)/partners/page.tsx`
- Create: `artifacts/web/app/(dashboard)/partners/[id]/page.tsx`
- Create: `artifacts/web/app/(dashboard)/partners/[id]/AnalyticsTab.tsx` (or inline)
- Create: `artifacts/web/app/(dashboard)/partners/[id]/ClientsTab.tsx`
- Create: `artifacts/web/app/(dashboard)/partners/[id]/DataTab.tsx`
- Create: `artifacts/web/app/(dashboard)/partners/[id]/DetailsTab.tsx`

- [ ] **Step 1: Create partners/page.tsx**

Copy `artifacts/adops/src/pages/Partners.tsx` to `artifacts/web/app/(dashboard)/partners/page.tsx`. Apply:
1. Add `"use client";` as first line
2. Wrap with `<PermissionGuard permission="View Partners">...</PermissionGuard>`
3. Replace wouter `Link`/`useLocation` with next/link and next/navigation

- [ ] **Step 2: Copy the four PartnerDetail tab files**

Copy each tab file to the `[id]/` directory:
- `artifacts/adops/src/pages/PartnerDetail/AnalyticsTab.tsx` → `artifacts/web/app/(dashboard)/partners/[id]/AnalyticsTab.tsx`
- `artifacts/adops/src/pages/PartnerDetail/ClientsTab.tsx` → `artifacts/web/app/(dashboard)/partners/[id]/ClientsTab.tsx`
- `artifacts/adops/src/pages/PartnerDetail/DataTab.tsx` → `artifacts/web/app/(dashboard)/partners/[id]/DataTab.tsx`
- `artifacts/adops/src/pages/PartnerDetail/DetailsTab.tsx` → `artifacts/web/app/(dashboard)/partners/[id]/DetailsTab.tsx`

Add `"use client";` to the top of each. Remove any wouter imports.

- [ ] **Step 3: Create partners/[id]/page.tsx**

Create `artifacts/web/app/(dashboard)/partners/[id]/page.tsx`:
```typescript
"use client";

import { useParams } from "next/navigation";
import { PermissionGuard } from "@/components/PermissionGuard";
// Paste full content of artifacts/adops/src/pages/PartnerDetail.tsx here,
// rename export to PartnerDetailPage accepting { id: number } prop.
// Update tab imports to use relative paths:
// import AnalyticsTab from "./AnalyticsTab";
// import ClientsTab from "./ClientsTab";
// import DataTab from "./DataTab";
// import DetailsTab from "./DetailsTab";

export default function PartnerDetailRoute() {
  const { id } = useParams<{ id: string }>();
  return (
    <PermissionGuard permission="View Partners">
      <PartnerDetailPage id={parseInt(id, 10)} />
    </PermissionGuard>
  );
}
```

- [ ] **Step 4: Run typecheck**

```bash
cd artifacts/web && pnpm typecheck
```
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add artifacts/web/app/(dashboard)/partners/
git commit -m "feat(web): port Partners and PartnerDetail pages (with 4 tabs)"
```

---

### Task 14: Port Financial Pages

**Files:**
- Create: `artifacts/web/app/(dashboard)/transactions/page.tsx`
- Create: `artifacts/web/app/(dashboard)/billings/page.tsx`
- Create: `artifacts/web/app/(dashboard)/payments/page.tsx`

Each follows the same pattern: copy source, add `"use client"`, add `PermissionGuard`, swap wouter → next.

- [ ] **Step 1: Create transactions/page.tsx**

Copy `artifacts/adops/src/pages/Transactions.tsx` to `artifacts/web/app/(dashboard)/transactions/page.tsx`. Apply:
1. Add `"use client";` as first line
2. Wrap with `<PermissionGuard permission="View Transactions">...</PermissionGuard>`
3. Replace wouter imports with next equivalents

- [ ] **Step 2: Create billings/page.tsx**

Copy `artifacts/adops/src/pages/Billings.tsx` to `artifacts/web/app/(dashboard)/billings/page.tsx`. Apply:
1. Add `"use client";` as first line
2. Wrap with `<PermissionGuard permission="View Billings">...</PermissionGuard>`
3. Replace wouter imports

- [ ] **Step 3: Create payments/page.tsx**

Copy `artifacts/adops/src/pages/Payments.tsx` to `artifacts/web/app/(dashboard)/payments/page.tsx`. Apply:
1. Add `"use client";` as first line
2. Wrap with `<PermissionGuard permission="View Payments">...</PermissionGuard>`
3. Replace wouter imports

- [ ] **Step 4: Run typecheck**

```bash
cd artifacts/web && pnpm typecheck
```
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add artifacts/web/app/(dashboard)/transactions/ artifacts/web/app/(dashboard)/billings/ artifacts/web/app/(dashboard)/payments/
git commit -m "feat(web): port Transactions, Billings, Payments pages"
```

---

### Task 15: Port Remaining Pages

**Files:**
- Create: `artifacts/web/app/(dashboard)/cost/page.tsx`
- Create: `artifacts/web/app/(dashboard)/upload/page.tsx`
- Create: `artifacts/web/app/(dashboard)/analytics/page.tsx`
- Create: `artifacts/web/app/(dashboard)/settings/page.tsx`

Same pattern for all: copy source, add `"use client"`, add `PermissionGuard`, swap wouter.

- [ ] **Step 1: Create cost/page.tsx**

Copy `artifacts/adops/src/pages/Cost.tsx` → `artifacts/web/app/(dashboard)/cost/page.tsx`.
Apply: `"use client"`, `<PermissionGuard permission="View Cost">`, replace wouter.

- [ ] **Step 2: Create upload/page.tsx**

Copy `artifacts/adops/src/pages/Upload.tsx` → `artifacts/web/app/(dashboard)/upload/page.tsx`.
Apply: `"use client"`, `<PermissionGuard permission="Upload Data">`, replace wouter.

- [ ] **Step 3: Create analytics/page.tsx**

Copy `artifacts/adops/src/pages/Analytics.tsx` → `artifacts/web/app/(dashboard)/analytics/page.tsx`.
Apply: `"use client"`, `<PermissionGuard permission="View Analytics">`, replace wouter.

- [ ] **Step 4: Create settings/page.tsx**

Copy `artifacts/adops/src/pages/Settings.tsx` → `artifacts/web/app/(dashboard)/settings/page.tsx`.
Apply: `"use client"`, `<PermissionGuard permission="Manage Settings">`, replace wouter.

Settings page uses `getCurrentUser`, `getUsers`, `saveUser`, `deleteUser`, `getRoles`, `saveRole`, `deleteRole` from `@/lib/auth` in the Vite SPA. In Next.js:
- `getCurrentUser()` → `useUser()` from `@/lib/auth/user-context`
- `getUsers()`, `saveUser()`, `deleteUser()` → direct `fetch` calls to `/api/users` (or keep as-is since they use `fetch` internally — just remove the auth header logic since cookies work automatically)
- `getRoles()`, `saveRole()`, `deleteRole()` → direct `fetch` calls to `/api/roles` (same approach)

Read `artifacts/adops/src/pages/Settings.tsx` before writing to understand exact imports. Replace each `@/lib/auth` import with the appropriate direct fetch or hook.

- [ ] **Step 5: Run typecheck**

```bash
cd artifacts/web && pnpm typecheck
```
Expected: zero errors. Fix any remaining `@/lib/auth` import errors by replacing with hooks or direct fetch calls.

- [ ] **Step 6: Commit**

```bash
git add artifacts/web/app/(dashboard)/cost/ artifacts/web/app/(dashboard)/upload/ artifacts/web/app/(dashboard)/analytics/ artifacts/web/app/(dashboard)/settings/
git commit -m "feat(web): port Cost, Upload, Analytics, Settings pages"
```

---

### Task 16: Final Typecheck and Verification

- [ ] **Step 1: Run full typecheck**

```bash
cd artifacts/web && pnpm typecheck
```
Expected: zero errors. Fix any remaining issues.

- [ ] **Step 2: Verify (dashboard)/page.tsx is no longer the placeholder**

Read `artifacts/web/app/(dashboard)/page.tsx`. It should contain the full Dashboard component, not the Phase 1+2 placeholder that just showed "Signed in as...".

- [ ] **Step 3: Check all pages exist**

```bash
find artifacts/web/app/\(dashboard\) -name "page.tsx" | sort
```

Expected output includes:
```
artifacts/web/app/(dashboard)/page.tsx
artifacts/web/app/(dashboard)/analytics/page.tsx
artifacts/web/app/(dashboard)/billings/page.tsx
artifacts/web/app/(dashboard)/buying-houses/[id]/page.tsx
artifacts/web/app/(dashboard)/buying-houses/page.tsx
artifacts/web/app/(dashboard)/clients/[id]/page.tsx
artifacts/web/app/(dashboard)/clients/page.tsx
artifacts/web/app/(dashboard)/cost/page.tsx
artifacts/web/app/(dashboard)/partners/[id]/page.tsx
artifacts/web/app/(dashboard)/partners/page.tsx
artifacts/web/app/(dashboard)/payments/page.tsx
artifacts/web/app/(dashboard)/settings/page.tsx
artifacts/web/app/(dashboard)/transactions/page.tsx
artifacts/web/app/(dashboard)/upload/page.tsx
```

- [ ] **Step 4: Verify no remaining @/lib/auth imports from the old Vite auth module**

```bash
grep -r "from \"@/lib/auth\"" artifacts/web/app/ artifacts/web/components/ artifacts/web/lib/
```

Expected: no matches (all auth calls should use `@/lib/auth/user-context`, `@/lib/auth/session`, or `@/lib/auth/require`).

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(web): Phase 4 complete — all frontend pages migrated to Next.js App Router"
```
