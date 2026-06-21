# Phase 4: Frontend Pages Migration — Design Spec

**Date:** 2026-06-21
**Branch:** feat/nextjs-migration
**Scope:** Port all 14 Vite SPA pages + layout components from `artifacts/adops/src/` into `artifacts/web/app/` using Next.js 15 App Router

---

## Goal

Replace the Vite SPA (`artifacts/adops/`) frontend with Next.js App Router pages so the entire platform — API routes and UI — is served from a single Next.js deployment. The Vite SPA continues running untouched until Phase 5 cutover.

---

## Architecture Decisions

### 1. Translation Strategy

Copy-and-adapt: copy every page and layout component directly from the Vite SPA, add `"use client"`, swap wouter → next/navigation, and replace the localStorage auth pattern with a React context backed by `GET /api/auth/me`. No logic is rewritten — pure translation for parity.

### 2. App Router Structure

```
artifacts/web/app/
├── layout.tsx                          # root — server, wraps with <Providers>
├── providers.tsx                       # "use client" — QueryClient, ThemeProvider, UserProvider
├── globals.css
├── login/
│   └── page.tsx                        # already done (Phase 1+2)
├── not-found.tsx                       # Next.js 404 convention
├── api/
│   └── auth/
│       └── me/
│           └── route.ts               # NEW — returns session user for client context
└── (dashboard)/
    ├── layout.tsx                      # NEW — server, renders <Layout>{children}</Layout>
    ├── page.tsx                        # replaces Phase 1+2 placeholder
    ├── clients/
    │   ├── page.tsx
    │   └── [id]/page.tsx
    ├── buying-houses/
    │   ├── page.tsx
    │   └── [id]/page.tsx
    ├── partners/
    │   ├── page.tsx
    │   └── [id]/page.tsx
    ├── transactions/page.tsx
    ├── billings/page.tsx
    ├── payments/page.tsx
    ├── cost/page.tsx
    ├── upload/page.tsx
    ├── analytics/page.tsx
    └── settings/page.tsx
```

The `(dashboard)` route group layout renders `<Layout>` (Sidebar + Topbar + FloatingChat) around every authenticated page. The Next.js middleware from Phase 1+2 already redirects unauthenticated requests to `/login`.

### 3. Auth & User Context

The Vite SPA reads user info from `localStorage`. Next.js uses an httpOnly cookie inaccessible to client components. Replacement:

**`GET /api/auth/me`** — reads the session cookie via `getSession()`, returns:
```json
{ "id": 1, "name": "...", "email": "...", "role": "...", "isSystem": false }
```
Returns 401 if no session.

**`lib/auth/user-context.tsx`** (`"use client"`) — replaces `lib/auth.ts`:
- `UserProvider` — wraps app in `providers.tsx`, fetches `/api/auth/me` once via TanStack Query (`staleTime: Infinity`)
- `useUser()` — returns `SessionUser | null`
- `useHasPermission(permission)` — fetches `/api/roles` once via TanStack Query, checks synchronously (System Admin always passes)
- `useLogout()` — calls `POST /api/users/logout`, then `router.push("/login")`, then invalidates `["me"]` query

**`components/PermissionGuard.tsx`** (`"use client"`) — replaces Vite `PermissionGuard`:
```typescript
export function PermissionGuard({ permission, children }) {
  const allowed = useHasPermission(permission);
  if (allowed === null) return <Spinner />;   // roles still loading
  if (!allowed) return <AccessDenied />;
  return children;
}
```

### 4. Auth Header Strategy

`@workspace/api-client-react` sends `Authorization: Bearer <token>` headers (built for Express). These are harmless noise in Next.js — the route handlers read the session cookie, not the header. The package is not modified during Phase 4 to avoid breaking the Vite SPA which still uses it with Express. Phase 5 cleanup removes the Express server entirely.

### 5. Layout Components

All layout components are copied to `artifacts/web/components/layout/` with `"use client"` added and wouter swapped for next/navigation:

| Import | Vite | Next.js |
|---|---|---|
| Link | `import { Link } from "wouter"` | `import Link from "next/link"` |
| Active route | `const [location] = useLocation()` | `const pathname = usePathname()` |
| Path check | `location.startsWith(href)` | `pathname.startsWith(href)` |
| User | `getCurrentUser()` | `useUser()` |
| Permission | `hasPermission(p)` | `useHasPermission(p)` |
| Logout | `logout()` | `useLogout()` |

`app/(dashboard)/layout.tsx` is a server component:
```typescript
import Layout from "@/components/layout/Layout";
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <Layout>{children}</Layout>;
}
```

### 6. Page Translation Rules

Every page:
1. Add `"use client"` as first line
2. Wrap content with `<PermissionGuard permission="...">`
3. Replace any auth calls with hooks from `user-context.tsx`

Dynamic route params — Vite passes `id` as a prop via route, Next.js uses `useParams()`:
```typescript
// app/(dashboard)/clients/[id]/page.tsx
"use client";
import { useParams } from "next/navigation";
export default function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  // pass parseInt(id, 10) to the page component
}
```

`@workspace/api-client-react` hooks are used unchanged — same names, same query keys, same response shapes. They call `/api/*` which now resolves to Next.js route handlers.

### 7. UI Components

All `artifacts/adops/src/components/ui/` files (40+ shadcn components) are copied wholesale to `artifacts/web/components/ui/` — no changes needed. They have no router or auth dependencies.

Additional copied files:
- `components/KycFields.tsx` — copied as-is, add `"use client"` if needed
- `hooks/use-mobile.tsx` — copied as-is
- `lib/utils.ts` — does NOT exist yet; copy from `artifacts/adops/src/lib/utils.ts` (exports `cn()` helper using `clsx` + `tailwind-merge`)

---

## Page Inventory

| Next.js path | Source file | Permission guard |
|---|---|---|
| `(dashboard)/page.tsx` | `Dashboard.tsx` | `"View Dashboard"` |
| `(dashboard)/clients/page.tsx` | `Clients.tsx` | `"View Clients"` |
| `(dashboard)/clients/[id]/page.tsx` | `ClientDetail.tsx` | `"View Clients"` |
| `(dashboard)/buying-houses/page.tsx` | `BuyingHouses.tsx` | `"View Buying Houses"` |
| `(dashboard)/buying-houses/[id]/page.tsx` | `BuyingHouseDetail.tsx` | `"View Buying Houses"` |
| `(dashboard)/partners/page.tsx` | `Partners.tsx` | `"View Partners"` |
| `(dashboard)/partners/[id]/page.tsx` | `PartnerDetail.tsx` + 4 sub-tab files | `"View Partners"` |
| `(dashboard)/transactions/page.tsx` | `Transactions.tsx` | `"View Transactions"` |
| `(dashboard)/billings/page.tsx` | `Billings.tsx` | `"View Billings"` |
| `(dashboard)/payments/page.tsx` | `Payments.tsx` | `"View Payments"` |
| `(dashboard)/cost/page.tsx` | `Cost.tsx` | `"View Cost"` |
| `(dashboard)/upload/page.tsx` | `Upload.tsx` | `"Upload Data"` |
| `(dashboard)/analytics/page.tsx` | `Analytics.tsx` | `"View Analytics"` |
| `(dashboard)/settings/page.tsx` | `Settings.tsx` | `"Manage Settings"` |
| `not-found.tsx` | `not-found.tsx` | none |

---

## New Dependencies

Add to `artifacts/web/package.json`:

| Package | Reason |
|---|---|
| `react-grid-layout` | Dashboard draggable widget grid |
| `recharts` | Charts in Dashboard and Analytics |
| `react-resizable` | Peer dep of react-grid-layout |

---

## New Files Summary

| File | Type | Purpose |
|---|---|---|
| `app/api/auth/me/route.ts` | server | Session user endpoint for UserProvider |
| `app/(dashboard)/layout.tsx` | server | Renders Layout shell around all dashboard pages |
| `lib/auth/user-context.tsx` | client | UserProvider, useUser, useHasPermission, useLogout |
| `components/PermissionGuard.tsx` | client | Permission-based render guard |
| `components/layout/Layout.tsx` | client | Copied + "use client" |
| `components/layout/Sidebar.tsx` | client | Copied + adapted (wouter → next/navigation) |
| `components/layout/Topbar.tsx` | client | Copied + adapted |
| `components/FloatingChat.tsx` | client | Copied + "use client" |
| `components/KycFields.tsx` | client | Copied as-is |
| `components/ui/*` | client | Copied wholesale (40+ shadcn components) |
| `hooks/use-mobile.tsx` | client | Copied as-is |
| `lib/utils.ts` | client | Copied from adops — exports `cn()` helper |

---

## Environment Variables

No new env vars required for Phase 4. All vars introduced in Phase 1+2 (`ADOPS_JWT_SECRET`, `DATABASE_URL`) remain sufficient.

---

## Verification Checklist

- [ ] `pnpm typecheck` passes with zero errors
- [ ] Login → dashboard redirect works
- [ ] Sidebar renders with correct nav items filtered by user role
- [ ] `PermissionGuard` blocks access and shows AccessDenied for missing permissions
- [ ] TanStack Query hooks fetch data (network tab shows `/api/*` calls)
- [ ] Dashboard draggable widget grid works (add/remove/resize widgets)
- [ ] PartnerDetail renders all 4 tabs (Details, Data, Clients, Analytics)
- [ ] Logout clears session cookie and redirects to `/login`
- [ ] Dark/light theme toggle works
- [ ] 404 page renders for unknown routes
