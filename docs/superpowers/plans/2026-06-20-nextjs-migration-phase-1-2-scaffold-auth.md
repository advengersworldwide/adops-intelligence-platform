# Next.js Migration — Phase 1 (Scaffold) + Phase 2 (Auth Cutover) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a new Next.js (App Router) app at `artifacts/web` that deploys to Vercel as one unit, with httpOnly-cookie JWT auth, an Upstash-backed login rate limiter, a `middleware.ts` auth gate, a ported login page, and a protected placeholder dashboard — proving the single-deploy + secure-auth foundation before any pages or routes are migrated.

**Architecture:** New `artifacts/web` workspace package consumes the existing `@workspace/db`, `@workspace/api-zod`, and `@workspace/api-client-react` libs via `transpilePackages`. Auth uses `jose` (Edge-compatible) for JWT sign/verify and `bcryptjs` (Node runtime) for password checks. The JWT lives in an httpOnly + Secure + SameSite=Lax cookie; `middleware.ts` verifies it on page routes and redirects to `/login`. Rate limiting uses `@upstash/ratelimit` + `@upstash/redis`.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS v4 (`@tailwindcss/postcss`), `next-themes`, TanStack Query v5, `jose`, `bcryptjs`, `@upstash/ratelimit`, Drizzle ORM (`@workspace/db`), Vitest (new test runner for `artifacts/web`).

---

## Context the engineer needs

- **Monorepo:** pnpm workspaces. Packages declared in `pnpm-workspace.yaml` under `artifacts/*` and `lib/*`. A `catalog:` block pins shared versions (e.g. `react: 19.1.0`, `vite`, `tailwindcss: ^4.1.14`, `@tanstack/react-query`, `tsx`). Use `catalog:` for those deps in `package.json`.
- **`minimumReleaseAge: 1440`** in `pnpm-workspace.yaml` blocks installing npm versions younger than 1 day. All deps in this plan are long-published, so this won't trigger.
- **Shared libs export TS source directly:** `@workspace/db` → `./src/index.ts` (exports `db`, `usersTable`, `rolesTable`, schema). `@workspace/db/schema` → `./src/schema/index.ts`. They are consumed via the `workspace` export condition (`tsconfig.base.json` sets `"customConditions": ["workspace"]`). Next must `transpilePackages` them.
- **DB connection** (`lib/db/src/index.ts`) reads `process.env.DATABASE_URL` and creates a `pg` Pool. No code change needed — on Vercel you set `DATABASE_URL` to Supabase's **pooled** string (pgBouncer, port 6543).
- **Existing login logic to port** lives in `artifacts/api-server/src/routes/users.ts` (bcrypt compare + JWT sign). Existing JWT payload shape: `{ sub, name, email, role, isSystem }`, `expiresIn: "24h"`.
- **Existing seed** (`artifacts/api-server/src/lib/seed.ts`) seeds 3 roles + a default admin (`admin@advengers.com`) from `ADMIN_DEFAULT_PASSWORD`.
- **Same-origin cookies:** `fetch` to a same-origin Route Handler sends cookies by default (`credentials: "same-origin"`). So the cookie rides along automatically — no `Authorization` header plumbing in this phase.
- **Commit discipline:** every task ends in a commit. Run `pnpm typecheck` from repo root before phase-completion commits.

## File structure (created in this plan)

```
artifacts/web/
  package.json                     workspace package manifest
  next.config.ts                   transpilePackages + config
  tsconfig.json                    extends ../../tsconfig.base.json
  postcss.config.mjs               Tailwind v4 postcss plugin
  vitest.config.ts                 test runner config
  .gitignore                       .next, etc.
  .env.example                     documented env vars
  app/
    globals.css                    copied theme from adops index.css
    layout.tsx                     root layout (server) -> Providers
    providers.tsx                  'use client' QueryClient + Theme + Toaster
    page.tsx                       (removed once dashboard group exists)
    (dashboard)/
      page.tsx                     protected placeholder dashboard (server)
    login/
      page.tsx                     ported login UI (client)
    api/
      users/
        login/route.ts            POST login -> sets cookie (Node runtime)
        logout/route.ts           POST logout -> clears cookie
  lib/
    auth/
      jwt.ts                       jose sign/verify (Edge-safe)
      cookies.ts                   cookie name + options
      session.ts                   server-side getSession() helper
    rate-limit.ts                  Upstash ratelimit wrapper
  scripts/
    seed.ts                        runnable seed (roles + admin)
  middleware.ts                    Edge auth gate + global rate limit
```

---

## Task 1: Scaffold the `artifacts/web` workspace package

**Files:**
- Create: `artifacts/web/package.json`
- Create: `artifacts/web/tsconfig.json`
- Create: `artifacts/web/next.config.ts`
- Create: `artifacts/web/.gitignore`

- [ ] **Step 1: Create `artifacts/web/package.json`**

```json
{
  "name": "@workspace/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "db:seed": "tsx scripts/seed.ts"
  },
  "dependencies": {
    "@radix-ui/react-tooltip": "^1.2.0",
    "@upstash/ratelimit": "^2.0.5",
    "@upstash/redis": "^1.34.3",
    "@workspace/api-client-react": "workspace:*",
    "@workspace/api-zod": "workspace:*",
    "@workspace/db": "workspace:*",
    "@tanstack/react-query": "catalog:",
    "bcryptjs": "^3.0.3",
    "jose": "^5.9.6",
    "lucide-react": "catalog:",
    "next": "^15.5.4",
    "next-themes": "^0.4.6",
    "react": "catalog:",
    "react-dom": "catalog:",
    "sonner": "^2.0.7"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "catalog:",
    "@tailwindcss/typography": "^0.5.15",
    "@types/bcryptjs": "^3.0.0",
    "@types/node": "catalog:",
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:",
    "tailwindcss": "catalog:",
    "tsx": "catalog:",
    "tw-animate-css": "^1.4.0",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 2: Create `artifacts/web/tsconfig.json`**

Next needs `moduleResolution: "bundler"`, the Next plugin, and the `@/*` path alias rooted at the app package.

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules", ".next", "dist"],
  "compilerOptions": {
    "incremental": true,
    "tsBuildInfoFile": ".tsbuildinfo",
    "noEmit": true,
    "jsx": "preserve",
    "lib": ["esnext", "dom", "dom.iterable"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "allowJs": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "types": ["node"],
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"]
    }
  }
}
```

- [ ] **Step 3: Create `artifacts/web/next.config.ts`**

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Consume workspace libs' TS source directly (no separate build step).
  transpilePackages: [
    "@workspace/db",
    "@workspace/api-zod",
    "@workspace/api-client-react",
  ],
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
```

- [ ] **Step 4: Create `artifacts/web/.gitignore`**

```gitignore
.next/
out/
next-env.d.ts
.tsbuildinfo
.vercel
```

- [ ] **Step 5: Install dependencies**

Run: `pnpm install`
Expected: completes without error; `artifacts/web` appears as a workspace package. (`next-env.d.ts` is generated on first `next dev`/`build`, not yet.)

- [ ] **Step 6: Commit**

```bash
git add artifacts/web/package.json artifacts/web/tsconfig.json artifacts/web/next.config.ts artifacts/web/.gitignore pnpm-lock.yaml
git commit -m "chore(web): scaffold Next.js workspace package"
```

---

## Task 2: Tailwind v4 + global styles + minimal layout

**Files:**
- Create: `artifacts/web/postcss.config.mjs`
- Create: `artifacts/web/app/globals.css` (copied from `artifacts/adops/src/index.css`)
- Create: `artifacts/web/app/layout.tsx`
- Create: `artifacts/web/app/page.tsx`

- [ ] **Step 1: Create `artifacts/web/postcss.config.mjs`**

```javascript
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

- [ ] **Step 2: Copy the theme stylesheet**

Copy the entire contents of `artifacts/adops/src/index.css` to `artifacts/web/app/globals.css` verbatim. It already begins with the Tailwind v4 directives this app needs:

```css
@import "tailwindcss";
@import "tw-animate-css";
@plugin "@tailwindcss/typography";

@custom-variant dark (&:is(.dark *));

@theme inline {
  /* ...full token block copied unchanged from adops/src/index.css... */
}
```

Run: `cp artifacts/adops/src/index.css artifacts/web/app/globals.css`
Expected: file exists and is identical to the source.

- [ ] **Step 3: Create the root layout `artifacts/web/app/layout.tsx`**

Server component. Imports global CSS and renders children. `suppressHydrationWarning` on `<html>` is required by `next-themes` (added in Task 3).

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AdOps Intelligence",
  description: "Advengers Worldwide — AdOps Intelligence Platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 4: Create a temporary home page `artifacts/web/app/page.tsx`**

```tsx
export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <p className="text-sm text-muted-foreground">AdOps Intelligence — scaffold OK</p>
    </main>
  );
}
```

- [ ] **Step 5: Build to verify the app compiles and Tailwind is wired**

Run: `pnpm --filter @workspace/web build`
Expected: build succeeds; output lists the `/` route. (`next-env.d.ts` is now generated.)

- [ ] **Step 6: Commit**

```bash
git add artifacts/web/postcss.config.mjs artifacts/web/app/globals.css artifacts/web/app/layout.tsx artifacts/web/app/page.tsx artifacts/web/next-env.d.ts
git commit -m "feat(web): tailwind v4 + global theme + minimal layout"
```

---

## Task 3: Client providers (next-themes + React Query + Toaster)

**Files:**
- Create: `artifacts/web/app/providers.tsx`
- Modify: `artifacts/web/app/layout.tsx`

- [ ] **Step 1: Create `artifacts/web/app/providers.tsx`**

`next-themes` replaces the adops `theme-provider` (which reads `localStorage` during render and would crash SSR). The `QueryClient` config mirrors `artifacts/adops/src/App.tsx` (`staleTime: 30_000`, `retry: 1`). `useState` ensures one client per browser session.

```tsx
"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Toaster } from "sonner";

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
        <TooltipPrimitive.Provider>
          {children}
          <Toaster richColors closeButton />
        </TooltipPrimitive.Provider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
```

- [ ] **Step 2: Wrap children with `Providers` in `artifacts/web/app/layout.tsx`**

Replace the body line `<body>{children}</body>` with:

```tsx
import { Providers } from "./providers";
```

and

```tsx
      <body>
        <Providers>{children}</Providers>
      </body>
```

- [ ] **Step 3: Build to verify providers compile**

Run: `pnpm --filter @workspace/web build`
Expected: build succeeds, no SSR/hydration errors in output.

- [ ] **Step 4: Commit**

```bash
git add artifacts/web/app/providers.tsx artifacts/web/app/layout.tsx
git commit -m "feat(web): client providers (next-themes, react-query, toaster)"
```

---

## Task 4: JWT session utilities with `jose` (TDD)

**Files:**
- Create: `artifacts/web/vitest.config.ts`
- Create: `artifacts/web/lib/auth/jwt.ts`
- Test: `artifacts/web/lib/auth/jwt.test.ts`

- [ ] **Step 1: Create `artifacts/web/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules", ".next"],
  },
});
```

- [ ] **Step 2: Write the failing test `artifacts/web/lib/auth/jwt.test.ts`**

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { signSession, verifySession, type SessionUser } from "./jwt";

const SECRET = "test-secret-at-least-32-chars-long-xxxxx";

beforeAll(() => {
  process.env.JWT_SECRET = SECRET;
});

const user: SessionUser = {
  sub: 1,
  name: "System Admin",
  email: "admin@advengers.com",
  role: "System Admin",
  isSystem: true,
};

describe("jwt session", () => {
  it("signs and verifies a session round-trip", async () => {
    const token = await signSession(user);
    const decoded = await verifySession(token);
    expect(decoded).toMatchObject(user);
  });

  it("rejects a tampered token", async () => {
    const token = await signSession(user);
    await expect(verifySession(token + "x")).rejects.toThrow();
  });

  it("returns null shape on a wrong-secret token", async () => {
    const token = await signSession(user);
    process.env.JWT_SECRET = "a-different-secret-also-32-chars-minimum";
    await expect(verifySession(token)).rejects.toThrow();
    process.env.JWT_SECRET = SECRET;
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @workspace/web exec vitest run lib/auth/jwt.test.ts`
Expected: FAIL — cannot resolve `./jwt`.

- [ ] **Step 4: Implement `artifacts/web/lib/auth/jwt.ts`**

`jose` works on both Edge and Node runtimes (unlike `jsonwebtoken`). This module is the single source of JWT truth for both `middleware.ts` (Edge) and route handlers (Node).

```typescript
import { SignJWT, jwtVerify } from "jose";

export interface SessionUser {
  sub: number;
  name: string;
  email: string;
  role: string;
  isSystem: boolean;
}

function getSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is required");
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({
    name: user.name,
    email: user.email,
    role: user.role,
    isSystem: user.isSystem,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.sub))
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(getSecretKey());
}

export async function verifySession(token: string): Promise<SessionUser> {
  const { payload } = await jwtVerify(token, getSecretKey());
  return {
    sub: Number(payload.sub),
    name: String(payload.name),
    email: String(payload.email),
    role: String(payload.role),
    isSystem: Boolean(payload.isSystem),
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @workspace/web exec vitest run lib/auth/jwt.test.ts`
Expected: PASS — 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add artifacts/web/vitest.config.ts artifacts/web/lib/auth/jwt.ts artifacts/web/lib/auth/jwt.test.ts
git commit -m "feat(web): jose-based JWT session sign/verify with tests"
```

---

## Task 5: Cookie options + server session helper

**Files:**
- Create: `artifacts/web/lib/auth/cookies.ts`
- Test: `artifacts/web/lib/auth/cookies.test.ts`
- Create: `artifacts/web/lib/auth/session.ts`

- [ ] **Step 1: Write the failing test `artifacts/web/lib/auth/cookies.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { SESSION_COOKIE, buildCookieOptions } from "./cookies";

describe("session cookie", () => {
  it("uses a stable cookie name", () => {
    expect(SESSION_COOKIE).toBe("adops-session");
  });

  it("is httpOnly, sameSite lax, path /, 24h maxAge", () => {
    const opts = buildCookieOptions();
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.path).toBe("/");
    expect(opts.maxAge).toBe(60 * 60 * 24);
  });

  it("is secure in production and not secure in development", () => {
    expect(buildCookieOptions("production").secure).toBe(true);
    expect(buildCookieOptions("development").secure).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/web exec vitest run lib/auth/cookies.test.ts`
Expected: FAIL — cannot resolve `./cookies`.

- [ ] **Step 3: Implement `artifacts/web/lib/auth/cookies.ts`**

```typescript
export const SESSION_COOKIE = "adops-session";

export interface CookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
}

export function buildCookieOptions(
  nodeEnv: string = process.env.NODE_ENV ?? "development",
): CookieOptions {
  return {
    httpOnly: true,
    secure: nodeEnv === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24, // 24h, matches JWT expiry
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @workspace/web exec vitest run lib/auth/cookies.test.ts`
Expected: PASS — 3 tests pass.

- [ ] **Step 5: Implement `artifacts/web/lib/auth/session.ts`**

Server-only helper to read the current session inside Server Components and Route Handlers. `cookies()` is async in Next 15.

```typescript
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "./cookies";
import { verifySession, type SessionUser } from "./jwt";

export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    return await verifySession(token);
  } catch {
    return null;
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add artifacts/web/lib/auth/cookies.ts artifacts/web/lib/auth/cookies.test.ts artifacts/web/lib/auth/session.ts
git commit -m "feat(web): session cookie options + server getSession helper"
```

---

## Task 6: Upstash rate-limit wrapper

**Files:**
- Create: `artifacts/web/lib/rate-limit.ts`
- Test: `artifacts/web/lib/rate-limit.test.ts`

- [ ] **Step 1: Write the failing test `artifacts/web/lib/rate-limit.test.ts`**

When Upstash env vars are absent (e.g. local dev without Redis), the limiter must fail open (allow) rather than crash.

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { checkRateLimit } from "./rate-limit";

describe("rate limit", () => {
  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  it("fails open (success=true) when Upstash is not configured", async () => {
    const result = await checkRateLimit("login", "1.2.3.4");
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/web exec vitest run lib/rate-limit.test.ts`
Expected: FAIL — cannot resolve `./rate-limit`.

- [ ] **Step 3: Implement `artifacts/web/lib/rate-limit.ts`**

```typescript
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

type Bucket = "login" | "global";

const LIMITS: Record<Bucket, { tokens: number; window: `${number} ${"s" | "m"}` }> = {
  login: { tokens: 10, window: "15 m" }, // mirrors old express loginLimiter
  global: { tokens: 100, window: "1 m" },
};

let redis: Redis | null = null;
const limiters = new Map<Bucket, Ratelimit>();

function getRedis(): Redis | null {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  redis = new Redis({ url, token });
  return redis;
}

function getLimiter(bucket: Bucket): Ratelimit | null {
  const existing = limiters.get(bucket);
  if (existing) return existing;
  const client = getRedis();
  if (!client) return null;
  const limiter = new Ratelimit({
    redis: client,
    limiter: Ratelimit.slidingWindow(LIMITS[bucket].tokens, LIMITS[bucket].window),
    prefix: `rl:${bucket}`,
  });
  limiters.set(bucket, limiter);
  return limiter;
}

export async function checkRateLimit(
  bucket: Bucket,
  identifier: string,
): Promise<{ success: boolean }> {
  const limiter = getLimiter(bucket);
  // Fail open when Upstash isn't configured (local dev).
  if (!limiter) return { success: true };
  const { success } = await limiter.limit(identifier);
  return { success };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @workspace/web exec vitest run lib/rate-limit.test.ts`
Expected: PASS — 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add artifacts/web/lib/rate-limit.ts artifacts/web/lib/rate-limit.test.ts
git commit -m "feat(web): upstash rate-limit wrapper that fails open without config"
```

---

## Task 7: Login Route Handler (sets httpOnly cookie)

**Files:**
- Create: `artifacts/web/app/api/users/login/route.ts`
- Test: `artifacts/web/app/api/users/login/route.test.ts`

- [ ] **Step 1: Write the failing test `artifacts/web/app/api/users/login/route.test.ts`**

The test mocks `@workspace/db` (so no real DB) and `bcryptjs`, then asserts a valid login returns 200 and sets the session cookie; an invalid login returns 401.

```typescript
import { describe, it, expect, vi, beforeAll } from "vitest";

const selectMock = vi.fn();

vi.mock("@workspace/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => selectMock() }) }),
  },
  usersTable: { email: "email" },
}));

vi.mock("bcryptjs", () => ({
  default: { compare: vi.fn(async (a: string, b: string) => a === "right" && b === "hash") },
}));

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret-at-least-32-chars-long-xxxxx";
  delete process.env.UPSTASH_REDIS_REST_URL;
});

async function call(body: unknown) {
  const { POST } = await import("./route");
  const req = new Request("http://localhost/api/users/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req);
}

describe("POST /api/users/login", () => {
  it("returns 200 + sets session cookie on valid credentials", async () => {
    selectMock.mockResolvedValueOnce([
      { id: 1, name: "Admin", email: "admin@advengers.com", password: "hash", role: "System Admin", isSystem: true },
    ]);
    const res = await call({ email: "admin@advengers.com", password: "right" });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("adops-session=");
    expect(res.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("returns 401 on wrong password", async () => {
    selectMock.mockResolvedValueOnce([
      { id: 1, name: "Admin", email: "admin@advengers.com", password: "hash", role: "System Admin", isSystem: true },
    ]);
    const res = await call({ email: "admin@advengers.com", password: "wrong" });
    expect(res.status).toBe(401);
  });

  it("returns 400 when fields are missing", async () => {
    const res = await call({ email: "" });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/web exec vitest run app/api/users/login/route.test.ts`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Implement `artifacts/web/app/api/users/login/route.ts`**

`runtime = "nodejs"` is required because `bcryptjs` and `pg` need Node APIs. Logic is ported from `artifacts/api-server/src/routes/users.ts` lines 36–70, swapping `jsonwebtoken` for `signSession` and the JSON token response for a cookie.

```typescript
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { signSession } from "@/lib/auth/jwt";
import { SESSION_COOKIE, buildCookieOptions } from "@/lib/auth/cookies";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  if (!process.env.JWT_SECRET) {
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { success } = await checkRateLimit("login", ip);
  if (!success) {
    return NextResponse.json(
      { error: "Too many login attempts. Please try again in 15 minutes." },
      { status: 429 },
    );
  }

  let body: { email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { email, password } = body;
  if (!email || !password) {
    return NextResponse.json({ error: "email and password are required" }, { status: 400 });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, normalizedEmail));

  const isValid = user ? await bcrypt.compare(String(password), user.password) : false;
  if (!user || !isValid) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = await signSession({
    sub: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isSystem: user.isSystem,
  });

  const res = NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email, role: user.role, isSystem: user.isSystem },
  });
  res.cookies.set(SESSION_COOKIE, token, buildCookieOptions());
  return res;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @workspace/web exec vitest run app/api/users/login/route.test.ts`
Expected: PASS — 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add artifacts/web/app/api/users/login/route.ts artifacts/web/app/api/users/login/route.test.ts
git commit -m "feat(web): login route handler sets httpOnly session cookie"
```

---

## Task 8: Logout Route Handler (clears cookie)

**Files:**
- Create: `artifacts/web/app/api/users/logout/route.ts`
- Test: `artifacts/web/app/api/users/logout/route.test.ts`

- [ ] **Step 1: Write the failing test `artifacts/web/app/api/users/logout/route.test.ts`**

```typescript
import { describe, it, expect } from "vitest";

describe("POST /api/users/logout", () => {
  it("returns 200 and expires the session cookie", async () => {
    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("adops-session=");
    expect(cookie).toContain("Max-Age=0");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/web exec vitest run app/api/users/logout/route.test.ts`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Implement `artifacts/web/app/api/users/logout/route.ts`**

```typescript
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/cookies";

export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @workspace/web exec vitest run app/api/users/logout/route.test.ts`
Expected: PASS — 1 test passes.

- [ ] **Step 5: Commit**

```bash
git add artifacts/web/app/api/users/logout/route.ts artifacts/web/app/api/users/logout/route.test.ts
git commit -m "feat(web): logout route handler clears session cookie"
```

---

## Task 9: `middleware.ts` — Edge auth gate + global rate limit

**Files:**
- Create: `artifacts/web/middleware.ts`
- Test: `artifacts/web/middleware.test.ts`

- [ ] **Step 1: Write the failing test `artifacts/web/middleware.test.ts`**

The middleware redirects unauthenticated page requests to `/login` and lets authenticated ones through. Uses `jose` to mint a real token for the "authenticated" case.

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import { signSession } from "./lib/auth/jwt";
import { middleware } from "./middleware";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret-at-least-32-chars-long-xxxxx";
  delete process.env.UPSTASH_REDIS_REST_URL;
});

function reqFor(path: string, token?: string) {
  const url = `http://localhost${path}`;
  const headers = new Headers();
  if (token) headers.set("cookie", `adops-session=${token}`);
  return new NextRequest(new Request(url, { headers }));
}

describe("middleware auth gate", () => {
  it("redirects unauthenticated page requests to /login", async () => {
    const res = await middleware(reqFor("/clients"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("allows authenticated requests through", async () => {
    const token = await signSession({
      sub: 1, name: "Admin", email: "admin@advengers.com", role: "System Admin", isSystem: true,
    });
    const res = await middleware(reqFor("/clients", token));
    // NextResponse.next() has no redirect location.
    expect(res.headers.get("location")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @workspace/web exec vitest run middleware.test.ts`
Expected: FAIL — cannot resolve `./middleware`.

- [ ] **Step 3: Implement `artifacts/web/middleware.ts`**

The `matcher` excludes `/login`, `/api/*` (route handlers self-enforce later), and Next internals/static assets — so this gate only guards page routes. Verification uses `jose` (Edge-safe).

```typescript
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "./lib/auth/cookies";
import { verifySession } from "./lib/auth/jwt";
import { checkRateLimit } from "./lib/rate-limit";

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const { success } = await checkRateLimit("global", ip);
  if (!success) {
    return new NextResponse("Too Many Requests", { status: 429 });
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  let authenticated = false;
  if (token) {
    try {
      await verifySession(token);
      authenticated = true;
    } catch {
      authenticated = false;
    }
  }

  if (!authenticated) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Guard all page routes except login, api, and static/internal assets.
    "/((?!login|api|_next/static|_next/image|favicon.ico).*)",
  ],
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @workspace/web exec vitest run middleware.test.ts`
Expected: PASS — 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add artifacts/web/middleware.ts artifacts/web/middleware.test.ts
git commit -m "feat(web): edge middleware auth gate + global rate limit"
```

---

## Task 10: Login page + protected dashboard placeholder

**Files:**
- Create: `artifacts/web/app/login/page.tsx`
- Delete: `artifacts/web/app/page.tsx`
- Create: `artifacts/web/app/(dashboard)/page.tsx`

This task needs the shadcn `Button` and `Input` primitives. To avoid a partial copy, port the two primitives plus their dependency `lib/utils.ts` (the `cn` helper). The full UI component migration happens in Phase 4; here we copy only what the login page imports.

- [ ] **Step 1: Copy the `cn` utility and the two primitives the login page needs**

```bash
mkdir -p artifacts/web/lib artifacts/web/components/ui
cp artifacts/adops/src/lib/utils.ts artifacts/web/lib/utils.ts
cp artifacts/adops/src/components/ui/button.tsx artifacts/web/components/ui/button.tsx
cp artifacts/adops/src/components/ui/input.tsx artifacts/web/components/ui/input.tsx
```

These files import via the `@/` alias (`@/lib/utils`), which Task 1's tsconfig maps to the app root — so `@/lib/utils`, `@/components/ui/button` resolve correctly. No edits needed.

- [ ] **Step 2: Copy the login page, then retarget it for Next**

Copy the source page verbatim (preserves the ~180 lines of JSX exactly — no transcription risk), then apply three small edits to the top and handler.

```bash
cp artifacts/adops/src/pages/Login.tsx artifacts/web/app/login/page.tsx
```

**Edit A — replace the import block + add `"use client"` + `useRouter`.** The source's first 5 lines are:

```tsx
import { useState } from "react";
import { Zap, Mail, Lock, AlertCircle, Eye, EyeOff, BarChart3, TrendingUp, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loginUser, setCurrentUser } from "@/lib/auth";
```

Replace them with (drops the `@/lib/auth` import that doesn't exist in `web`, adds the client directive and router):

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Zap, Mail, Lock, AlertCircle, Eye, EyeOff, BarChart3, TrendingUp, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
```

**Edit B — add the router hook.** Immediately after `export default function LoginPage() {`, insert as the first line of the body:

```tsx
  const router = useRouter();
```

**Edit C — replace the `handleSubmit` function** (source lines 14–32) with the cookie-based version (the server sets the cookie; no localStorage):

```tsx
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const res = await fetch("/api/users/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      if (res.ok) {
        router.push("/");
        router.refresh();
      } else if (res.status === 429) {
        setError("Too many attempts. Please try again later.");
      } else {
        setError("Invalid email or password. Please try again.");
      }
    } catch {
      setError("Unable to connect to server. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };
```

Leave the rest of the file (the `stats` array and the entire `return (...)` JSX) untouched — its imports (`@/components/ui/button`, `@/components/ui/input`, lucide icons) all resolve in `web` via the files copied in Step 1.

- [ ] **Step 3: Delete the temporary home page and create the protected dashboard**

```bash
rm artifacts/web/app/page.tsx
mkdir -p "artifacts/web/app/(dashboard)"
```

Create `artifacts/web/app/(dashboard)/page.tsx` (server component). It reads the session server-side; `middleware.ts` already guarantees authentication, but reading the session proves the cookie → server flow end-to-end.

```tsx
import { getSession } from "@/lib/auth/session";

export default async function DashboardPage() {
  const session = await getSession();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-2 bg-background text-foreground">
      <h1 className="text-2xl font-bold">AdOps Intelligence</h1>
      <p className="text-sm text-muted-foreground" data-testid="welcome">
        Signed in as {session?.name ?? "unknown"} ({session?.role})
      </p>
    </main>
  );
}
```

- [ ] **Step 4: Build to verify everything compiles**

Run: `pnpm --filter @workspace/web build`
Expected: build succeeds; routes list `/`, `/login`, `/api/users/login`, `/api/users/logout`.

- [ ] **Step 5: Commit**

```bash
git add artifacts/web/lib/utils.ts artifacts/web/components/ui/button.tsx artifacts/web/components/ui/input.tsx "artifacts/web/app/(dashboard)/page.tsx" artifacts/web/app/login/page.tsx
git rm artifacts/web/app/page.tsx
git commit -m "feat(web): login page + protected dashboard placeholder"
```

---

## Task 11: Seed script (roles + default admin)

**Files:**
- Create: `artifacts/web/scripts/seed.ts`

- [ ] **Step 1: Create `artifacts/web/scripts/seed.ts`**

Ports `artifacts/api-server/src/lib/seed.ts` into a standalone runnable script (no server startup hook on serverless). The `db:seed` package script (Task 1) runs it with `tsx`.

```typescript
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, rolesTable, usersTable } from "@workspace/db";

const DEFAULT_ROLES = [
  {
    name: "System Admin",
    permissions: [
      "View Dashboard", "View Clients", "Edit Clients",
      "View Partners", "Edit Partners",
      "View Buying Houses", "Edit Buying Houses",
      "View Transactions", "View Billings", "View Payments", "View Cost", "Upload Data",
      "View Analytics", "Manage Settings",
    ] as string[],
    isSystem: true,
  },
  {
    name: "Viewer",
    permissions: [
      "View Dashboard", "View Clients", "View Partners",
      "View Buying Houses",
      "View Transactions", "View Billings", "View Payments", "View Cost", "View Analytics",
    ] as string[],
    isSystem: true,
  },
  {
    name: "Operator",
    permissions: [
      "View Dashboard", "View Clients", "Edit Clients",
      "View Partners", "Edit Partners",
      "View Buying Houses", "Edit Buying Houses",
      "View Transactions", "View Billings", "View Payments", "View Cost", "Upload Data",
      "View Analytics",
    ] as string[],
    isSystem: true,
  },
];

async function seedDefaults() {
  for (const role of DEFAULT_ROLES) {
    const rows = await db.select().from(rolesTable);
    const existing = rows.find((r) => r.name === role.name);
    if (!existing) {
      await db.insert(rolesTable).values(role);
    } else {
      await db.update(rolesTable).set({ permissions: role.permissions }).where(eq(rolesTable.name, role.name));
    }
  }

  const users = await db.select().from(usersTable);
  const existingAdmin = users.find((u) => u.email === "admin@advengers.com");
  if (!existingAdmin) {
    const adminPassword = process.env.ADMIN_DEFAULT_PASSWORD;
    if (!adminPassword) {
      console.warn("[seed] ADMIN_DEFAULT_PASSWORD not set — skipping default admin seed");
    } else {
      const hashedPassword = await bcrypt.hash(adminPassword, 12);
      await db.insert(usersTable).values({
        name: "System Admin",
        email: "admin@advengers.com",
        password: hashedPassword,
        role: "System Admin",
        isSystem: true,
      });
      console.log("[seed] default admin created");
    }
  }
  console.log("[seed] done");
}

seedDefaults()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed] failed", err);
    process.exit(1);
  });
```

- [ ] **Step 2: Run the seed against the dev database**

Requires `DATABASE_URL` and `ADMIN_DEFAULT_PASSWORD` in `../../.env` (repo root) or the shell env.

Run: `cd artifacts/web && DATABASE_URL="$DATABASE_URL" ADMIN_DEFAULT_PASSWORD="$ADMIN_DEFAULT_PASSWORD" pnpm db:seed`
Expected: prints `[seed] done` (and `[seed] default admin created` on first run).

- [ ] **Step 3: Commit**

```bash
git add artifacts/web/scripts/seed.ts
git commit -m "feat(web): runnable seed script for roles + default admin"
```

---

## Task 12: Vercel + env documentation

**Files:**
- Create: `artifacts/web/.env.example`
- Create: `artifacts/web/README.md`

- [ ] **Step 1: Create `artifacts/web/.env.example`**

```bash
# Postgres (Supabase) — use the POOLED connection string (pgBouncer, port 6543) for serverless
DATABASE_URL=postgresql://user:pass@host:6543/postgres?pgbouncer=true

# Auth
JWT_SECRET=replace-with-a-32+-char-random-secret
ADMIN_DEFAULT_PASSWORD=set-strong-password-then-rotate

# AI
GROQ=your-groq-api-key

# Supabase Storage (file uploads — used in Phase 3)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key

# Upstash Redis (rate limiting) — free tier
UPSTASH_REDIS_REST_URL=https://your-db.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-token

# Optional: Sentry
# NEXT_PUBLIC_SENTRY_DSN=
```

- [ ] **Step 2: Create `artifacts/web/README.md`**

```markdown
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
```

- [ ] **Step 3: Commit**

```bash
git add artifacts/web/.env.example artifacts/web/README.md
git commit -m "docs(web): env example + deploy/auth README"
```

---

## Task 13: Phase verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full web test suite**

Run: `pnpm --filter @workspace/web test`
Expected: all test files pass (jwt, cookies, rate-limit, login route, logout route, middleware).

- [ ] **Step 2: Run repo-wide typecheck**

Run: `pnpm typecheck`
Expected: no type errors across the workspace, including `@workspace/web`.

- [ ] **Step 3: Run the production build**

Run: `pnpm --filter @workspace/web build`
Expected: build succeeds; route list shows `/` (dashboard), `/login`, `/api/users/login`, `/api/users/logout`, and `middleware`.

- [ ] **Step 4: Manual end-to-end login flow (dev server)**

With `DATABASE_URL`, `JWT_SECRET`, and a seeded admin set, run `pnpm --filter @workspace/web dev` and verify:
1. Visiting `http://localhost:3000/` while logged out → redirects to `/login`.
2. Submitting wrong credentials → shows "Invalid email or password".
3. Submitting `admin@advengers.com` + `ADMIN_DEFAULT_PASSWORD` → lands on `/` showing "Signed in as System Admin (System Admin)".
4. In devtools → Application → Cookies, `adops-session` is present and marked **HttpOnly**.
5. `curl -i -X POST http://localhost:3000/api/users/logout` returns a `Set-Cookie` with `Max-Age=0`.

Expected: all five checks pass.

- [ ] **Step 5: Final phase commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "chore(web): phase 1-2 verification fixes" --allow-empty
```

---

## Self-review notes (for the implementer)

- **`jose`, not `jsonwebtoken`:** middleware runs on the Edge runtime where `jsonwebtoken` (Node `crypto`) fails. `jose` is used everywhere for one source of truth.
- **`runtime = "nodejs"`** on the login/logout handlers because `bcryptjs` + `pg` need Node.
- **`next-themes`, not the adops `theme-provider`:** the latter reads `localStorage` during render and crashes SSR.
- **Rate limiter fails open** without Upstash env so local dev works; production sets the env and it fails closed at the configured limits.
- **Cookie auto-sends** on same-origin fetch, so no `Authorization` header wiring this phase. (`setAuthTokenGetter` stays relevant only for a future cross-origin mobile client.)
- **`getSession()` is the only server auth helper this phase.** A `requireAuth()` / `requirePermission()` pair (which throws/403s rather than returning null) is deferred to **Phase 3**, where the ported Route Handlers actually need it. Page-route protection here is handled entirely by `middleware.ts`.
- **Sentry deferred (deviation from spec Phase 1).** The spec lists Sentry under Phase 1, but it is observability, not part of the auth/deploy foundation, and `@sentry/nextjs` needs its own non-trivial wiring (`instrumentation.ts`, client/server configs, source-map upload). It is intentionally pushed to a later task so this phase stays focused on the deployable secure-auth shell. Flag for the user.
- **Out of scope here (later phases):** porting the other 19 route groups + `requireAuth`/`requirePermission` (Phase 3), migrating the 14 pages and the full UI component set (Phase 4), Sentry wiring, deleting `adops` + `api-server` (Phase 5).
```
