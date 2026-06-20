# Next.js Migration — Design

**Date:** 2026-06-20
**Status:** Approved (design); pending implementation plan
**Scope:** Migrate the web frontend (`artifacts/adops`, Vite + React SPA) and the standalone API (`artifacts/api-server`, Express) into a single idiomatic Next.js (App Router) application deployed as one unit on Vercel. The OpenAPI codegen pipeline and shared `lib/*` packages are preserved. Profit/analytics calculations and the partners-onboarding restructure are out of scope here.

## Context — current state

Monorepo (pnpm workspaces). Each layer is the source of truth for the next:

`lib/db/src/schema/*` (Drizzle) → `lib/api-spec/openapi.yaml` (API contract) → orval generates `lib/api-zod` (zod + TS types) and `lib/api-client-react` (React Query hooks + `custom-fetch.ts` mutator) → `artifacts/api-server/src/routes/*` (Express 5) → `artifacts/adops/src/pages/*` (React 19 + wouter).

Today:
- **Frontend** (`artifacts/adops`): Vite 7 + React 19 client-side SPA. wouter routing, 14 pages, 50+ Radix/shadcn UI components, TanStack Query v5, Tailwind v4, Recharts, Sentry. Auth is **JWT in localStorage**, sent as a `Bearer` header. Permission guards are client-side ([App.tsx](../../../artifacts/adops/src/App.tsx) `PermissionGuard`).
- **Backend** (`artifacts/api-server`): Express 5, 20 route groups, esbuild bundle. `requireAuth`/`requireAdmin`/`optionalAuth` middleware ([middlewares/auth.ts](../../../artifacts/api-server/src/middlewares/auth.ts)). Multer file uploads → Supabase Storage. Pino logging. Groq SDK. `express-rate-limit`. CORS allowlist. `express.json` 512kb limit. `seedDefaults()` runs at startup before `app.listen`.
- **Codegen client** ([custom-fetch.ts](../../../lib/api-client-react/src/custom-fetch.ts)): runtime-agnostic, calls relative `/api/*` paths via a configurable base URL. Already contains React Native handling; React is pinned to `19.1.0` "because expo requires it" — i.e. a mobile/Expo consumer is anticipated.
- **DB** (`lib/db`): Drizzle ORM + `pg` (PostgreSQL/Supabase). `drizzle-kit push`.
- Two deploy targets today: static frontend + always-on Node API server.

## Goal

One `git push` → one Vercel deploy of frontend + API together. Eliminate the separate Express service. Take the opportunity to harden auth (out of localStorage) since this work sits on the `fix/security-audit` branch.

## Decisions (locked with user)

1. **Migration depth:** Idiomatic Next.js rewrite — Server Components for reads (direct Drizzle access), Route Handlers for writes. Not a mechanical SPA-in-Next port.
2. **API layer:** **Keep the REST contract.** Express routes become Next.js Route Handlers at `app/api/*`; `lib/api-spec/openapi.yaml` stays the source of truth; `api-zod` + `api-client-react` codegen survives untouched. Reason: zero extra deploy cost (handlers ship inside the Next app), the pipeline already works, and only a REST API can serve the anticipated Expo mobile client (Server Actions cannot).
3. **Auth:** Move JWT from localStorage into an **httpOnly, Secure, SameSite=Lax cookie** (XSS hardening). Keep the existing custom JWT + bcrypt + DB-backed roles/permissions model — do **not** adopt a third-party auth library.
4. **Rate limiting:** Replace `express-rate-limit` (in-memory, unreliable on stateless serverless) with `@upstash/ratelimit` + `@upstash/redis` (free tier).
5. **Deployment:** Vercel, single project, Root Directory = `artifacts/web`.
6. **Strategy:** Phased strangler migration with shippable checkpoints — not big-bang.

## Target architecture

The monorepo stays. Add one app (`artifacts/web`); retire two (`adops`, `api-server`) at the end.

```
artifacts/
  web/                       NEW Next.js (App Router)
    app/
      (dashboard)/           Server Components (reads via Drizzle)
        dashboard/page.tsx
        clients/[id]/page.tsx
        ...
      login/page.tsx
      api/                   Route Handlers (writes; mobile-consumable)
        clients/route.ts
        ...
      layout.tsx             root providers (QueryClient, Theme, Tooltip)
    middleware.ts            cookie auth gate + rate limiting
    next.config.ts           transpilePackages for @workspace/*
  adops/                     DELETED after cutover
  api-server/                DELETED after cutover
  mockup-sandbox/            untouched
lib/
  db/                        unchanged (shared Drizzle schema)
  api-spec/                  unchanged (OpenAPI source of truth)
  api-zod/                   unchanged (generated validators)
  api-client-react/          unchanged (generated hooks; client mutations + mobile)
```

`next.config.ts` lists `transpilePackages: ["@workspace/db", "@workspace/api-zod", "@workspace/api-client-react"]` so Next consumes their TS source directly (the libs export `./src/index.ts`); no separate build step for the libs.

**Data flow:**
- **Reads** → Server Component imports `lib/db` (Drizzle) and queries directly. Fast first paint, no client round-trip.
- **Writes** → client component → generated hook (`api-client-react`) → `/api/*` Route Handler → validates with `api-zod` → `lib/db`.

## Auth & security model

- **Login** (`/api/users/login`): verify bcrypt password, sign JWT, set it as an httpOnly + Secure + SameSite=Lax cookie. Stop returning the token for localStorage. The `/api/users/login` route stays public (no auth gate).
- **`middleware.ts`**: runs on protected routes, reads the cookie, verifies the JWT (`JWT_SECRET`), redirects unauthenticated users to `/login`.
- **Server-side enforcement**: port `requireAuth()` / `requireAdmin()` into a shared helper that reads + verifies the cookie, usable in both Route Handlers and Server Components. Add `requirePermission(name)` backed by the existing DB roles. Server checks are the real enforcement.
- **Client-side guards**: keep the existing `PermissionGuard` UX for hiding nav/UI; it is presentation-only, not the security boundary.
- **Rate limiting**: a helper wrapping `@upstash/ratelimit`, applied in `middleware.ts` globally and tightened per-handler for sensitive routes (login). Requires `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`.
- **CORS**: dropped for the web app (frontend + API are same-origin). Re-added as a small per-handler helper on `/api/*` only when a mobile client needs it.
- **Body limits + Zod validation**: enforced explicitly per Route Handler (Express's `express.json({ limit })` does not carry over).
- **Logging**: Pino remains usable in Next server runtime; request-scoped logging adapted to Route Handlers.
- **File uploads** (`/api/uploads/*`): Multer is Express-specific and removed; Route Handlers read `await request.formData()` and pass the buffer to the same Supabase Storage call.

## Seeding, env & deployment

- **Seeding**: `seedDefaults()` has no serverless startup hook. Convert to a `pnpm db:seed` script (in `lib/db` or a `scripts` entry) run manually or in CI after deploy. Seeds roles + default admin (no entity sample data exists today).
- **DB connection**: Drizzle uses Supabase's **pooled** connection string (pgBouncer, port 6543) so concurrent serverless invocations don't exhaust Postgres connections.
- **Env vars (Vercel)**: `JWT_SECRET`, `GROQ`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `DATABASE_URL` (pooled), `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`. Optional Sentry: `SENTRY_*`.
- **Deploy**: Vercel project, Root Directory `artifacts/web`, framework auto-detected (Next). One deploy = frontend + API.

## Migration phases (strangler)

Each phase is independently shippable and leaves a working app.

1. **Scaffold** — Next app in `artifacts/web`; `transpilePackages`; root providers (QueryClient, Theme, Tooltip); Tailwind v4; Sentry. Deploys an empty authenticated shell to Vercel. Acceptance: empty app builds and deploys; `pnpm typecheck` passes.
2. **Auth cutover** — login route sets cookie; `middleware.ts` gate; server `requireAuth`/`requirePermission` helpers; Upstash rate limiting wired. Acceptance: login → cookie → protected route works end-to-end; bad/expired token redirects to `/login`; login is rate-limited.
3. **Route Handlers** — port all 20 Express route groups to `app/api/*`, each validated by `api-zod`; ports Multer uploads to `formData()`; Pino/Groq/Supabase calls preserved. Acceptance: each handler enforces auth, rejects invalid input, and passes a happy-path smoke test; the (still-old) SPA can run against Next's `/api`.
4. **Page migration** — move the 14 pages in batches into App Router; convert read-heavy pages to Server Components fetching via Drizzle; keep interactive/mutating views as client components using generated hooks. Acceptance per batch: manual verification checklist passes; `pnpm typecheck` passes.
5. **Cutover & cleanup** — point Vercel/DNS at the new app; delete `artifacts/adops` and `artifacts/api-server`; remove dead deps; update docs. Acceptance: production serves from `artifacts/web`; old apps removed; build green.

**Rejected alternative — big-bang rewrite:** no working checkpoints across a multi-week change; too risky.

## Testing

- `api-zod` contract validation remains the request/response guardrail at the API boundary.
- Per-Route-Handler smoke tests: auth required, validation rejects bad input, happy path succeeds.
- Manual verification checklist per page batch in Phase 4.
- Every phase must pass `pnpm typecheck` before it is considered done.

## Out of scope

- Profit/analytics calculation changes (`computeRow`).
- Partners rename / onboarding restructure (separate spec, 2026-06-18).
- Building the Expo mobile client (the REST contract is preserved to keep it possible later).
- Adopting a third-party auth library.

## Risks & mitigations

- **Rate limiting on serverless** — addressed by Upstash (Decision 4).
- **DB connection exhaustion** — addressed by the pooled Supabase connection string.
- **Seed step forgotten** — documented as an explicit `pnpm db:seed` post-deploy step.
- **Multi-week duration** — mitigated by the phased strangler order; each phase ships independently.