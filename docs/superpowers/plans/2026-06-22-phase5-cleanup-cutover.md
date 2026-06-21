# Phase 5: Cleanup + Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the legacy Vite SPA and Express API server, create a Vercel deployment config, and update the root build script so `artifacts/web/` is the sole deployment target.

**Architecture:** Straight deletion of two artifacts that were fully superseded in Phases 3 and 4, followed by targeted config updates. No code is rewritten — this phase only removes and configures.

**Tech Stack:** pnpm workspaces, Next.js 15, Vercel

**Worktree:** `e:\Futurama Projects\adops-intelligence-platform\.worktrees\feat-nextjs-migration\`

---

### Task 1: Verify No Stale References Before Deletion

**Files:** none created or modified

Before deleting anything, confirm that no surviving source file imports from the two artifacts being removed.

- [ ] **Step 1: Grep for adops imports in surviving code**

Run from the worktree root in PowerShell:
```powershell
Select-String -Path "artifacts/web/**/*.ts","artifacts/web/**/*.tsx","lib/**/*.ts" -Pattern "artifacts/adops" -Recurse
```

Expected: **zero matches**. If any matches appear, stop and investigate before proceeding.

- [ ] **Step 2: Grep for api-server imports in surviving code**

```powershell
Select-String -Path "artifacts/web/**/*.ts","artifacts/web/**/*.tsx","lib/**/*.ts" -Pattern "artifacts/api-server" -Recurse
```

Expected: **zero matches**. If any matches appear, stop and investigate.

- [ ] **Step 3: Confirm adops and api-server are not referenced in workspace configs**

```powershell
Select-String -Path "pnpm-workspace.yaml","package.json","tsconfig.json","tsconfig.base.json" -Pattern "adops|api-server"
```

Expected: **zero matches** (the workspace glob `artifacts/*` covers them implicitly but does not name them).

---

### Task 2: Delete artifacts/api-server

**Files:**
- Delete: `artifacts/api-server/` (entire directory)

- [ ] **Step 1: Delete the directory**

```powershell
Remove-Item -Recurse -Force "artifacts/api-server"
```

- [ ] **Step 2: Verify it is gone**

```powershell
Test-Path "artifacts/api-server"
```

Expected: `False`

- [ ] **Step 3: Commit**

```powershell
git add -A
git commit -m "chore: delete artifacts/api-server (superseded by Next.js route handlers)"
```

---

### Task 3: Delete artifacts/adops

**Files:**
- Delete: `artifacts/adops/` (entire directory)

- [ ] **Step 1: Delete the directory**

```powershell
Remove-Item -Recurse -Force "artifacts/adops"
```

- [ ] **Step 2: Verify it is gone**

```powershell
Test-Path "artifacts/adops"
```

Expected: `False`

- [ ] **Step 3: Commit**

```powershell
git add -A
git commit -m "chore: delete artifacts/adops (superseded by Next.js app router pages)"
```

---

### Task 4: Update Root package.json Build Script

**Files:**
- Modify: `package.json` (root)

The current `build` script runs `pnpm -r --if-present run build` which recurses across all workspace packages. After deletion, only `artifacts/web` remains as a deployable artifact. The new script targets it directly, including its local workspace dependencies via the `...` filter.

- [ ] **Step 1: Read current package.json**

Read `package.json` at the worktree root. Current content:
```json
{
  "name": "workspace",
  "version": "0.0.0",
  "license": "MIT",
  "scripts": {
    "preinstall": "npx only-allow pnpm",
    "build": "pnpm run typecheck && pnpm -r --if-present run build",
    "typecheck:libs": "tsc --build",
    "typecheck": "pnpm run typecheck:libs && pnpm -r --filter \"./artifacts/**\" --filter \"./scripts\" --if-present run typecheck"
  },
  "private": true,
  "devDependencies": {
    "prettier": "^3.8.3",
    "typescript": "~5.9.3"
  }
}
```

- [ ] **Step 2: Replace the build script**

Edit `package.json`. Change only the `build` line:

```json
{
  "name": "workspace",
  "version": "0.0.0",
  "license": "MIT",
  "scripts": {
    "preinstall": "npx only-allow pnpm",
    "build": "pnpm --filter @workspace/web... build",
    "typecheck:libs": "tsc --build",
    "typecheck": "pnpm run typecheck:libs && pnpm -r --filter \"./artifacts/**\" --filter \"./scripts\" --if-present run typecheck"
  },
  "private": true,
  "devDependencies": {
    "prettier": "^3.8.3",
    "typescript": "~5.9.3"
  }
}
```

The `typecheck` script uses `--filter "./artifacts/**"` which now only matches `artifacts/web` — no change needed there.

- [ ] **Step 3: Commit**

```powershell
git add package.json
git commit -m "chore: update root build script to target @workspace/web only"
```

---

### Task 5: Create vercel.json

**Files:**
- Create: `vercel.json` (at worktree root)

Vercel will build from the repo root so pnpm can resolve workspace symlinks for `@workspace/db`, `@workspace/api-zod`, and `@workspace/api-client-react`.

- [ ] **Step 1: Create vercel.json**

Create `vercel.json` at the worktree root with this exact content:

```json
{
  "installCommand": "pnpm install --frozen-lockfile",
  "buildCommand": "pnpm --filter @workspace/web... build",
  "outputDirectory": "artifacts/web/.next",
  "framework": "nextjs"
}
```

- `installCommand` — installs all workspace deps from root, creating symlinks for `@workspace/*` packages
- `buildCommand` — builds `@workspace/web` and its local dependencies
- `outputDirectory` — where Next.js emits its build output, relative to the repo root
- `framework` — enables Vercel's Next.js-specific features (preview URLs, ISR, edge functions)

- [ ] **Step 2: Commit**

```powershell
git add vercel.json
git commit -m "feat: add vercel.json for Next.js monorepo deployment"
```

---

### Task 6: Final Verification

**Files:** none modified

- [ ] **Step 1: Re-run pnpm install**

```powershell
pnpm install
```

Expected: clean install with no warnings about missing workspace packages. If you see "ERR_PNPM_WORKSPACE_PKG_NOT_FOUND" for `adops` or `api-server`, a `package.json` somewhere still references them — stop and investigate.

- [ ] **Step 2: Run typecheck**

```powershell
pnpm typecheck
```

Expected: zero errors. The `typecheck` script runs `tsc --build` (libs) then typechecks `./artifacts/**` (now only `artifacts/web`).

- [ ] **Step 3: Run production build**

```powershell
pnpm build
```

Expected: Next.js production build completes successfully. Output ends with something like:
```
✓ Compiled successfully
✓ Collecting page data
✓ Generating static pages
Route (app) ...
```

- [ ] **Step 4: Verify only artifacts/web remains**

```powershell
Get-ChildItem -Path "artifacts" -Directory | Select-Object Name
```

Expected output:
```
web
```

- [ ] **Step 5: Confirm vercel.json exists at root**

```powershell
Test-Path "vercel.json"
```

Expected: `True`

- [ ] **Step 6: Final commit**

```powershell
git add -A
git commit -m "feat: Phase 5 complete — single Next.js deployment, legacy artifacts removed"
```

---

## Environment Variables Reminder

These must be set in the Vercel project dashboard before the first deploy (not in `vercel.json`):

| Variable | Purpose |
|---|---|
| `ADOPS_JWT_SECRET` | Session cookie signing |
| `DATABASE_URL` | Drizzle ORM (Neon/Postgres) |
| `GROQ` | AI chat route handler |
| `UPSTASH_REDIS_REST_URL` | AI chat rate limiting |
| `UPSTASH_REDIS_REST_TOKEN` | AI chat rate limiting |
| `NEXT_PUBLIC_SUPABASE_URL` | Payment attachment upload |
| `SUPABASE_SERVICE_ROLE_KEY` | Payment attachment upload |
