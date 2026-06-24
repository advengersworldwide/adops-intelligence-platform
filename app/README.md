# @workspace/web — Next.js app

Single-deploy Next.js (App Router) app replacing `artifacts/adops` + `artifacts/api-server`.

## Local dev
1. Copy `.env.example` to the repo root `.env` and fill values.
2. `pnpm --filter @workspace/web dev` (http://localhost:3000)
3. Seed once: `pnpm --filter @workspace/web db:seed`

## Deploy (Vercel)
- New Vercel project, **Root Directory = `artifacts/web`**.
- Framework auto-detected (Next.js). One deploy serves frontend + `/api/*`.
- Set env vars from `.env.example` in Vercel project settings.
- Use the **pooled** Supabase `DATABASE_URL` (port 6543) so serverless functions don't exhaust connections.
- After first deploy, run the seed once (locally pointed at prod DB, or via a CI step).

## Auth
- JWT stored in an httpOnly + Secure + SameSite=Lax cookie (`adops-session`).
- `middleware.ts` verifies it (via `jose`, Edge-safe) and redirects unauthenticated page requests to `/login`.
- Login/logout: `POST /api/users/login`, `POST /api/users/logout`.
