# AdOps Intelligence Platform — System Audit

**Date:** 2026-05-31
**Scope:** Full system — security (CSO), code health, codebase map, logic/sanity, mock & dead-code review
**Verdict:** 🔴 **NOT production-ready.** Core data layer is well-built, but the newly-added auth layer is fundamentally insecure (no real authentication or authorization) and live secrets are unprotected.

---

## 1. System map (what this actually is)

A Replit-scaffolded **pnpm monorepo**, spec-driven:

```
artifacts/
  adops/           React 19 + Vite + Tailwind + shadcn/ui + wouter + TanStack Query  (the product UI)
  api-server/      Express 5 + Drizzle + Pino  (REST API under /api)
  mockup-sandbox/  Replit design-mockup harness  (NOT part of the product — see §5)
lib/
  db/              Drizzle schema + pg Pool (Supabase Postgres)
  api-spec/        openapi.yaml  →  orval codegen source of truth
  api-zod/         generated Zod request/response schemas
  api-client-react/ generated TanStack Query hooks + custom-fetch
```

**The intended architecture is sound:** `openapi.yaml` → orval generates `api-zod` (validation) + `api-client-react` (typed hooks). The data domains (clients, platforms, campaigns, transactions, analytics, upload) follow it faithfully — Zod-validated input, typed Drizzle queries with joins, proper 400/404/204 handling. **This part is good.**

**The auth layer (uncommitted) breaks the architecture** — see §2 and §4.

**Typecheck:** ✅ passes clean (`pnpm run typecheck`, exit 0).

---

## 2. Security findings (CSO)

### 🔴 CRITICAL

**S1 — Live secrets in `.env`, and `.env` is NOT git-ignored.**
`.env` contains real, live credentials:
- `DATABASE_URL` — Supabase Postgres incl. password `Advengers786.`
- `RESEND` — live `re_...` API key
- `GROQ` — live `gsk_...` API key

`.gitignore` has **no `.env` pattern**. `git status` shows `?? .env` and `?? artifacts/adops/.env` — untracked but *not ignored*. A single `git add .` commits them; once pushed they are leaked permanently (history rewrite + key rotation required).
**Fix:** add `.env`, `.env.*`, `!.env.example` to `.gitignore` now; **rotate all three secrets** (assume compromised); add a checked-in `.env.example` with placeholders.

**S2 — No server-side authorization. Every `/api/*` endpoint is fully open.**
`app.ts` mounts routes with zero auth middleware. There is no token/session check anywhere on the server. Consequences, exploitable by anyone who can reach the API:
- `POST /api/users` → create a **System Admin** account (`isSystem` is attacker-controlled via `req.body`, see `users.ts:75`).
- `GET /api/users` → enumerate all users.
- `DELETE /api/campaigns/:id`, `POST /api/upload`, etc. → full read/write/delete of all business data.
- `POST /api/roles` → redefine permissions.

The RBAC in the UI (`PermissionGuard`, `hasPermission`) is **cosmetic only** — it gates rendering, not data access.
**Fix:** issue a real session token/cookie at login; add auth + role-enforcement middleware on the server; never trust `isSystem`/`role` from the request body.

**S3 — Passwords stored and compared in plaintext.**
- `auth.ts` schema: `password: text("password").notNull()` — no hashing.
- `users.ts:34`: `if (!user || user.password !== password)` — plaintext comparison.
- `seed.ts:55`: seeds `password: "Admin@123"` in plaintext.
A DB read (or the leaked `DATABASE_URL` in S1) exposes every password.
**Fix:** hash with `bcrypt`/`argon2` on write; compare hashes on login; migrate/re-seed existing rows.

**S4 — Authentication is forgeable client-side.**
Login (`POST /api/users/login`) returns the user object; the frontend stores it in `localStorage["adops-active-user"]` (`auth.ts:119`). No token is issued. Any user can open devtools and run
`localStorage.setItem("adops-active-user", JSON.stringify({role:"System Admin"}))`
to become admin in the UI — and since the backend (S2) checks nothing, the forged identity also unlocks every API call.

**S5 — Hardcoded default admin credentials.**
`seed.ts`: `admin@advengers.com` / `Admin@123`, seeded on every boot. Known-credential backdoor if it survives to any shared/deployed environment.

### 🟠 HIGH / MEDIUM

**S6 — CORS wide open.** `app.use(cors())` (`app.ts:28`) allows all origins with no allowlist. Combined with S2/S4, any website can drive the API on a victim's behalf. **Fix:** restrict `origin` to known frontends.

**S7 — Internal error messages leaked to clients.** Every auth route does `catch (error: any) { res.status(500).json({ error: error.message }) }` (`users.ts`, `roles.ts`). Leaks DB/driver internals. The data routes don't do this. **Fix:** log server-side, return a generic message.

**S8 — No rate limiting / lockout on login.** Enables credential brute-force / user enumeration (401 vs 400 distinguishes states). **Fix:** rate-limit `/users/login`; uniform error responses.

---

## 3. Code health

| Check | Result |
|---|---|
| Typecheck (`pnpm run typecheck`) | ✅ Pass (exit 0) |
| Lint | ⚠️ **None configured** — root `package.json` has only `typecheck`/`build`; no ESLint anywhere |
| Tests | ⚠️ **Zero** — no `*.test.*`/`*.spec.*` in the project (only inside `node_modules`) |
| Build | Not run in this audit; typecheck (its gate) passes |
| Supply chain | ✅ Strong: `minimumReleaseAge: 1440` in `pnpm-workspace.yaml`, vulnerable `esbuild` overridden |

**Takeaway:** typed and clean, but **no automated safety net** (no lint, no tests) for a financial/ad-spend app. Recommend ESLint + a minimal API integration test suite (auth + one CRUD domain) before further feature work.

---

## 4. Logic & sanity — divergences, not-operational, and inconsistencies

**L1 — Auth bypasses the entire spec-driven pipeline.**
`/users`, `/roles`, `/users/login` exist **only** as hand-written Express routes. They are **absent from `openapi.yaml`**, so they have no generated Zod schema and no generated client. Effects:
- `users.ts`/`roles.ts` read `req.body` directly with manual `if` checks instead of `safeParse` — inconsistent with every other route and weaker validation.
- The frontend talks to them via a separate hand-rolled `auth.ts` fetch layer instead of the generated hooks the rest of the app uses.
**Fix:** add the auth paths to `openapi.yaml` and regenerate, or at minimum validate with `@workspace/api-zod`-style schemas.

**L2 — `auth.ts` hardcodes `http://localhost:8080/api` (`auth.ts:31`) → auth breaks outside local dev.**
The generated client (`custom-fetch.ts`) defaults to **relative** URLs (`_baseUrl = null`), so data calls go through the Vite dev proxy (`/api` → `:8080`) and same-origin in prod — correct. But `auth.ts` uses an absolute localhost URL, so **login, user/role management all fail in any deployed environment** (Replit autoscale exposes 8080→:80, frontend 19416→:3000 per `.replit`). It only "works" locally because CORS is wide open (S6).
**Fix:** use a relative `/api` base (and the proxy/same-origin) like the generated client.

**L3 — Dead "AI Assistant" widget.** `Dashboard.tsx:271–291` renders an input + "Ask" button with **no state, no `onChange`, no `onClick`** — purely decorative, labeled "Beta". This is the home of the orphaned `GROQ` key (S1) — the AI feature was scaffolded in UI and never implemented.
**Fix:** wire it up, or remove the widget (and the Groq key).

**L4 — Orphaned secrets / deps for features that don't exist.**
- `GROQ` key → no code references it (intended for L3's dead widget).
- `RESEND` key → no code references it (intended for "weekly report" emails — also non-functional, see L5).
- `cookie-parser` is a declared dependency of `api-server` but **never imported** (`app.ts` doesn't use it) — leftover from an intended cookie-session auth that was never built (corroborates S4).

**L5 — Non-persistent Settings UI presented as real.** In `Settings.tsx`, the Notifications toggles (`alertNegative`, `alertLowMargin`, `weeklyReport`), "Data Retention: 24 months", and "Analytics collection" are pure local React state — they persist nowhere and drive nothing. The currency settings *are* real (localStorage + live FX API). Mixed real/cosmetic controls in one panel is misleading.

**L6 — Minor:** `error: any` typing in auth routes; `seedDefaults()` runs on every boot (idempotent, but two full-table scans per start); login lacks timing-safe comparison (moot until S3 is fixed).

---

## 5. Irrelevant / dead weight (cleanup candidates)

| Item | Assessment |
|---|---|
| `artifacts/mockup-sandbox/` | Replit design-mockup harness with a full duplicated shadcn/ui set. Not imported by the product. **Dead weight** — remove if not actively used for design iteration. |
| `attached_assets/` | Original generation prompt (`Pasted-You-are-a-senior-...txt`) + a `636KB image_*.png`. Build cruft. The Vite `@assets` alias points here but no source imports it. |
| `replit.md`, `.agents/`, `skills-lock.json`, `.replit*` | Replit/agent scaffolding — harmless but not product code. |

---

## 6. Prioritized remediation

**Do before any commit/push:**
1. **S1** — add `.env*` to `.gitignore`; rotate Supabase password + Resend + Groq keys; add `.env.example`.

**Do before any shared/staging deploy:**
2. **S3** — hash passwords (bcrypt/argon2); re-seed.
3. **S2 + S4** — real session tokens + server-side auth/role middleware; stop trusting `role`/`isSystem` from request bodies.
4. **S5** — remove/force-rotate the default admin; require first-boot password set.
5. **L2** — fix the hardcoded `localhost:8080` API base in `auth.ts`.

**Hardening / consistency:**
6. **S6** CORS allowlist · **S7** stop leaking `error.message` · **S8** login rate-limit.
7. **L1** — bring auth endpoints into the OpenAPI/Zod pipeline.

**Quality / hygiene:**
8. Add ESLint + a minimal auth/CRUD test suite (§3).
9. Resolve dead features: wire or delete the AI widget (L3) and orphaned keys/deps (L4); make Settings toggles real or remove them (L5).
10. Remove `mockup-sandbox` / `attached_assets` if unused (§5).

---

*Note: this audit reviewed source statically and ran the typecheck. It did not run the app, exercise the live API, or run a dependency CVE scan (`pnpm audit`) — recommended as follow-ups.*
