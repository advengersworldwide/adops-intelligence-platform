# Phase 5: Cleanup + Cutover — Design Spec

**Date:** 2026-06-22
**Branch:** feat/nextjs-migration
**Scope:** Delete `artifacts/adops/` and `artifacts/api-server/`, create `vercel.json`, update root `package.json` build script — leaving `artifacts/web/` as the single deployment target.

---

## Goal

Remove the two legacy artifacts that have been fully superseded by the Next.js migration:
- `artifacts/adops/` — Vite SPA (all pages migrated in Phase 4)
- `artifacts/api-server/` — Express API server (all 41 route handlers ported in Phase 3)

After this phase the repository contains one deployable artifact (`artifacts/web/`) supported by three shared workspace libs (`@workspace/db`, `@workspace/api-zod`, `@workspace/api-client-react`).

---

## Architecture Decisions

### 1. What Gets Deleted

| Path | Reason |
|---|---|
| `artifacts/adops/` | Vite SPA fully replaced by `artifacts/web/app/` pages |
| `artifacts/api-server/` | Express routes fully replaced by `artifacts/web/app/api/` handlers |

Nothing in the surviving codebase imports from either deleted artifact. The `lib/` packages are **kept** — `artifacts/web` depends on all three.

### 2. pnpm-workspace.yaml

No change required. The current glob `artifacts/*` resolves to `artifacts/web` alone after deletion — still correct.

### 3. Root package.json Build Script

Current `build` script runs a recursive build across all workspace packages. After deletion, the script must target only the web app and its local dependencies.

Replace:
```json
"build": "<old recursive command>"
```
With:
```json
"build": "pnpm --filter @workspace/web... build"
```

The `...` (trailing ellipsis) filter syntax means "this package and all its local workspace dependencies" — so `@workspace/db`, `@workspace/api-zod`, and `@workspace/api-client-react` are included automatically if they have build steps.

### 4. vercel.json (new file at repo root)

No `vercel.json` exists anywhere in the repository. Vercel deploys from the repo root so it can resolve pnpm workspace symlinks for the three `@workspace/*` dependencies.

```json
{
  "installCommand": "pnpm install --frozen-lockfile",
  "buildCommand": "pnpm --filter @workspace/web... build",
  "outputDirectory": "artifacts/web/.next",
  "framework": "nextjs"
}
```

- `installCommand` — installs all workspace deps from root, creating symlinks for `@workspace/*` packages
- `buildCommand` — builds `@workspace/web` and its local deps
- `outputDirectory` — path to Next.js build output, relative to repo root
- `framework` — tells Vercel this is a Next.js app (enables preview URLs, edge config, etc.)

### 5. Files Left Unchanged

| File | Reason |
|---|---|
| `pnpm-workspace.yaml` | `artifacts/*` glob still correct |
| `tsconfig.base.json` | References no deleted packages |
| `lib/` packages | All still used by `artifacts/web` |
| `.replit`, `.replitignore` | Replit-specific, not in Vercel's path |

---

## Verification Steps

1. **`pnpm install`** — re-run from root; confirms no dangling workspace references after deletion
2. **`pnpm typecheck`** — zero errors; confirms no surviving file imports from deleted artifacts
3. **`pnpm --filter @workspace/web... build`** — full Next.js production build passes; confirms the app compiles without the deleted packages
4. **Stale reference grep** — search for any `artifacts/adops` or `artifacts/api-server` strings in surviving source files; expect zero matches

---

## New Files Summary

| File | Change |
|---|---|
| `vercel.json` | Created — Vercel monorepo deployment config |
| `package.json` (root) | Modified — update `build` script |
| `artifacts/adops/` | Deleted |
| `artifacts/api-server/` | Deleted |

---

## Environment Variables Required for Deployment

These must be set in the Vercel project dashboard (not stored in `vercel.json`):

| Variable | Used by |
|---|---|
| `ADOPS_JWT_SECRET` | Session cookie signing (jose JWT) |
| `DATABASE_URL` | Drizzle ORM (Neon/Postgres) |
| `GROQ` | AI chat route handler |
| `UPSTASH_REDIS_REST_URL` | AI chat rate limiting |
| `UPSTASH_REDIS_REST_TOKEN` | AI chat rate limiting |
| `NEXT_PUBLIC_SUPABASE_URL` | Payment attachment upload |
| `SUPABASE_SERVICE_ROLE_KEY` | Payment attachment upload |
