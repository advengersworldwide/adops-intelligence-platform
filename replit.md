# AdOps Intelligence Platform

An internal SaaS web app for media resellers to manage DSP advertising platforms, clients, campaigns, spend tracking, and profitability analytics.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, proxied at `/api`)
- `pnpm --filter @workspace/adops run dev` — run the frontend (port 19416, proxied at `/`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/scripts run seed` — seed the database with sample data
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite, wouter routing, Recharts, shadcn/ui, react-hook-form + zod, TailwindCSS v4
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec → `lib/api-zod` Zod schemas + `lib/api-client-react` React Query hooks)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/adops/src/pages/` — all frontend pages (Dashboard, Clients, Platforms, Campaigns, Transactions, Upload, Analytics, Settings)
- `artifacts/adops/src/components/layout/` — Layout, Sidebar, Topbar
- `artifacts/adops/src/components/theme-provider.tsx` — ThemeProvider with `{ theme, setTheme }` API
- `artifacts/api-server/src/routes/` — all API routes (clients, platforms, campaigns, transactions, analytics, upload)
- `lib/db/src/schema/` — Drizzle ORM tables (clients, platforms, campaigns, transactions)
- `lib/api-spec/` — OpenAPI spec (source of truth for API contract)
- `lib/api-zod/` — Zod validation schemas (generated from OpenAPI)
- `lib/api-client-react/` — React Query hooks (generated from OpenAPI)
- `scripts/src/seed.ts` — DB seed script

## Architecture decisions

- Contract-first API: OpenAPI spec → Orval codegen → Zod schemas for server validation + React Query hooks for frontend
- Profit is always computed server-side as `spend - cost` before DB insert
- CSV upload matches campaigns by name (exact match required)
- Alerts are computed at query time from aggregated transaction data (negative profit = critical, margin <10% = warning)
- ThemeProvider uses `setTheme("light" | "dark" | "system")` — not `toggleTheme`

## Product

- **Dashboard**: KPI cards (revenue, cost, profit, margin), profit/revenue area chart over time, client bar chart, alert panel, AI assistant placeholder, recent transactions table
- **Clients**: Full CRUD with buying house, pricing model (fixed/percentage), margin value
- **Platforms**: Full CRUD with DSP-specific cost model and currency + analytics overlay
- **Campaigns**: Full CRUD with client + platform assignment, filterable by client/platform
- **Transactions**: View/filter/delete spend records; CSV export; red/amber row highlighting for underperforming campaigns
- **Upload Data**: Drag-and-drop CSV import with preview and import results
- **Analytics**: Deep-dive charts (time series, by client, by platform), date range filter, CSV export per chart
- **Settings**: Theme selection, notification preferences

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Always run `pnpm --filter @workspace/api-spec run codegen` after changing the OpenAPI spec before touching server or frontend code
- Run `pnpm --filter @workspace/db run push` after changing `lib/db/src/schema/`
- The ThemeProvider API is `{ theme, setTheme }` — not `toggleTheme`
- Scripts package needs `@workspace/db` in `dependencies` (not devDependencies) to run seed

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
