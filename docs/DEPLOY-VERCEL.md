# Deploying to Vercel

This is a **pnpm monorepo**. The deployable app is the Next.js 15 app in [`app/`](../app);
it consumes workspace libraries from [`lib/*`](../lib) via `transpilePackages` (no separate
build step for the libs). Because the Next.js app lives in a subdirectory, Vercel must be
told where it is — see step 2.

Production build is verified: `pnpm --filter @workspace/web build` compiles clean, emitting
serverless functions for every `/api/*` route, SSR/static pages, and the edge middleware.

---

## 1. Provision external services

Create these first — you'll paste their credentials into Vercel in step 3.

| Service | Purpose | Required? |
| --- | --- | --- |
| **Supabase** (Postgres) | Primary database (Drizzle ORM via `node-postgres`) | **Required** |
| **Supabase Storage** | File uploads (payment/PO attachments) | Required if uploads are used |
| **Groq** | AI chat endpoint (`/api/ai/chat`) | Required if AI is used |
| **Upstash Redis** | Rate limiting in middleware | Optional — rate limiter **fails open** if absent |

### Supabase Postgres — use the POOLED connection string

The app uses `node-postgres` connection pooling in serverless functions, so you **must** use
Supabase's **pooled** connection (pgBouncer, port **6543**), not the direct connection (5432).
Using the direct string will exhaust connections under serverless load.

In Supabase: **Project Settings → Database → Connection string → "Transaction" pooler**. It
looks like:

```
postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true
```

Keep the `?pgbouncer=true` flag.

---

## 2. Import the repo and set the Root Directory ⚠️ (the one setting that matters)

1. In Vercel: **Add New → Project → Import** this Git repository.
2. On the configure screen, set **Root Directory = `app`** (click *Edit* next to Root Directory
   and pick the `app` folder).

This is the critical step. With Root Directory = `app`, Vercel:

- auto-detects the **Next.js** framework and provisions the API serverless functions + edge
  middleware correctly,
- detects the **pnpm workspace** above `app/` and installs from the repo root, so the
  `@workspace/*` libs resolve,
- automatically includes source files outside the root directory in the build.

Leave **Framework Preset = Next.js**, **Build Command**, and **Output Directory** on their
auto-detected defaults. [`app/vercel.json`](../app/vercel.json) pins the install command to a
frozen lockfile for reproducible builds.

> If the build ever fails to find `../lib/*`, enable **Settings → General → Include source
> files outside of the Root Directory** (usually already on for detected monorepos).

---

## 3. Set environment variables

In **Vercel → Settings → Environment Variables**, add the following for **Production** (and
Preview if you want preview deploys to work). Vercel exposes these at both build and runtime.

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | ✅ | Supabase **pooled** string from step 1 (port 6543, `?pgbouncer=true`). |
| `JWT_SECRET` | ✅ | 32+ char random string. Generate: `openssl rand -base64 48`. Session signing (jose). |
| `ADMIN_DEFAULT_PASSWORD` | ✅ | Password for the seeded admin user. Rotate after first login. |
| `TOTP_ENCRYPTION_KEY` | ✅ | 32 bytes, **base64-encoded**, encrypting TOTP secrets at rest. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. **Losing or rotating it makes every enrolled 2FA secret undecryptable and forces all users to re-enrol.** |
| `GROQ` | ⬜ | Groq API key. Required only for the AI chat endpoint. |
| `SUPABASE_URL` | ⬜ | `https://<ref>.supabase.co`. Required for file uploads. |
| `SUPABASE_SERVICE_KEY` | ⬜ | Supabase service-role key. Required for file uploads. **Secret — server only.** |
| `UPSTASH_REDIS_REST_URL` | ⬜ | Upstash REST URL. Enables rate limiting; omit to disable (fails open). |
| `UPSTASH_REDIS_REST_TOKEN` | ⬜ | Upstash REST token. |
| `NEXT_PUBLIC_SENTRY_DSN` | ⬜ | Optional error tracking. |

`DATABASE_URL` and `JWT_SECRET` are read at build time (the db client and `next build` evaluate
them), so they must exist before the first build. See [`.env.example`](../.env.example) for the
canonical list.

---

## 4. Initialize the database (one time)

Run these **from your machine, pointed at the production `DATABASE_URL`**, before or right after
the first deploy. Set `DATABASE_URL` in your shell to the production pooled string first.

```bash
# 1. Create/update the schema
pnpm --filter @workspace/db push

# 2. Seed default RBAC roles (System Admin / Operator / Viewer) + the admin user
#    (needs ADMIN_DEFAULT_PASSWORD set in your shell too)
pnpm --filter @workspace/web db:seed

# 3. Only if importing pre-existing custom roles with legacy permission strings:
pnpm --filter @workspace/web db:migrate-rbac
```

`db:seed` creates the initial admin login using `ADMIN_DEFAULT_PASSWORD`.

---

## 5. Deploy

Push to your production branch (or click **Deploy** on the import screen). Vercel builds and
deploys automatically. Every push to the production branch redeploys; PRs get preview
deployments.

### Deploying via the Vercel CLI (already configured)

This project is already linked to the Vercel project
`advengers-projects/adops-intelligence-platform`, with **Root Directory = `app`** set on the
project. To ship a new production build from the CLI:

```bash
# IMPORTANT: run from the REPO ROOT, not app/.
# The whole pnpm workspace (lockfile + lib/* + scripts) must be uploaded so the
# frozen install can resolve the @workspace/* packages. Deploying from app/ alone
# fails with "Headless installation requires a pnpm-lock.yaml file".
cd <repo-root>
vercel deploy --prod
```

`.vercelignore` deliberately keeps `lib/` and `scripts/` (workspace members) in the upload and
excludes only `node_modules`, build output, and scratch dirs.

---

## 6. Verify

- **Health:** `GET https://<your-app>.vercel.app/api/healthz` → `{"status":"ok"}`.
- **Auth:** open the site — unauthenticated requests redirect to `/login` (edge middleware).
- **Login:** sign in with the **username** `admin` — not the email. The login form authenticates
  on `username`, and `db:seed` creates that user as `admin` / `admin@advengers.com`. Use
  `ADMIN_DEFAULT_PASSWORD`, then rotate it.
- **2FA:** enrol from `/account`. This is the only flow that reads `TOTP_ENCRYPTION_KEY`, so a
  missing key surfaces here at runtime rather than at build time.
- **Data:** confirm a data-backed page (e.g. `/clients`) loads — proves the pooled DB connection.

---

## Production tuning (optional)

- **Function region:** set **Settings → Functions → Region** to the region closest to your
  Supabase project to cut DB latency (default is `iad1`/US-East).
- **Long-running routes:** the import (`/api/import/[type]`) and AI (`/api/ai/chat`) routes can
  exceed the default function timeout on heavy payloads. On a **Pro** plan you can raise it by
  adding to `app/vercel.json`:
  ```json
  "functions": {
    "app/api/import/[type]/route.ts": { "maxDuration": 60 },
    "app/api/ai/chat/route.ts": { "maxDuration": 60 }
  }
  ```
  (Omit on Hobby — that plan caps function duration and will reject a raised `maxDuration`.)
- **Uptime:** point an uptime monitor at `/api/healthz`.

---

## Troubleshooting

| Symptom | Cause / Fix |
| --- | --- |
| Build error: `DATABASE_URL must be set` | Add `DATABASE_URL` to Vercel env vars (build reads it). |
| API routes 404 / pages don't render server-side | Root Directory not set to `app` — Next.js wasn't detected. Fix step 2. |
| `Cannot find module @workspace/db` at build | Enable "Include source files outside of the Root Directory"; confirm Root Directory = `app`. |
| DB "too many connections" / timeouts | You're using the direct (5432) string. Switch to the pooled (6543) string with `?pgbouncer=true`. |
| Lockfile / install failures | Commit an up-to-date `pnpm-lock.yaml`; install uses `--frozen-lockfile`. |
