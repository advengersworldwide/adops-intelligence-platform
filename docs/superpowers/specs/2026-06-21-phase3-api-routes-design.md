# Phase 3: Express → Next.js Route Handlers — Design Spec

**Date:** 2026-06-21
**Branch:** feat/nextjs-migration
**Scope:** Port all 21 Express route files to 41 Next.js 15 App Router Route Handlers under `artifacts/web/app/api/`

---

## Goal

Replace the Express API server's route layer with idiomatic Next.js 15 Route Handlers so the frontend and API can be deployed as a single Next.js application. The Express server (`artifacts/api-server/`) remains untouched until Phase 5 cutover.

---

## Architecture Decisions

### 1. Translation Strategy

Flat 1:1 translation: each Express route file becomes one or more Next.js `route.ts` files. No shared HOFs or wrapper abstractions. Every handler is self-contained and can be audited side-by-side against its Express counterpart.

### 2. Runtime

Every route handler exports:
```typescript
export const runtime = "nodejs";
```
Required because Drizzle ORM uses Node.js APIs not available in the Edge runtime.

### 3. Auth Translation

Express uses `requireAuth` / `requireAdmin` middleware injected per-route. Next.js uses cookie-based session (httpOnly `adops-session` cookie, jose JWT). Translation pattern via `lib/auth/require.ts`:

```typescript
// Replaces: router.get("/path", requireAuth, handler)
const auth = await requireAuth();
if (isAuthError(auth)) return auth;

// Replaces: router.post("/path", requireAuth, requireAdmin, handler)
const auth = await requireAdmin();
if (isAuthError(auth)) return auth;

// auth.user is type SessionUser with .sub (userId), .email, .role, .isSystem
```

**Only mirror what Express protects — do not add auth to public routes.**

Protected routes (from Express source):
- `GET /roles` — requireAuth
- `POST /roles`, `DELETE /roles/:name` — requireAdmin
- `GET /users`, `POST /users`, `DELETE /users/:email` — requireAdmin
- `POST /ai/chat` — requireAuth + rate limit

All other routes are public (no auth check).

### 4. Rate Limiting (AI Chat)

Use `@upstash/ratelimit` with Upstash Redis — not in-memory Map — so limits persist across cold starts and multiple instances.

```typescript
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(20, "1 m"),
});
const { success } = await ratelimit.limit(`ai:${auth.user.sub}`);
if (!success) return NextResponse.json({ error: "Too many requests. Please wait before sending another message." }, { status: 429 });
```

Requires env vars: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.

### 5. computeRow Placement

Local copy at `artifacts/web/lib/compute-row.ts`. Not extracted to a shared workspace package — the Express server is deleted in Phase 5, making the overlap window too short to justify a new `@workspace/shared` package.

### 6. Async Params (Next.js 15)

Dynamic route params are a Promise in Next.js 15 and must be awaited:

```typescript
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const numericId = parseInt(id, 10);
}
```

### 7. Other Express → Next.js Translations

| Express pattern | Next.js equivalent |
|---|---|
| `req.query` | `new URL(req.url).searchParams` + `Object.fromEntries()` |
| `req.body` | `await req.json()` wrapped in try/catch |
| `res.json(data)` | `NextResponse.json(data)` |
| `res.status(N).json(data)` | `NextResponse.json(data, { status: N })` |
| `res.sendStatus(204)` | `new Response(null, { status: 204 })` |
| `multer` file upload | `await request.formData()` + `file.arrayBuffer()` |
| `res.write()` / `res.end()` (SSE) | `ReadableStream` + `TextEncoder` |

### 8. SSE Streaming (AI Chat)

```typescript
const encoder = new TextEncoder();
const readableStream = new ReadableStream({
  async start(controller) {
    try {
      for await (const chunk of groqStream) {
        const token = chunk.choices[0]?.delta?.content ?? "";
        if (token) controller.enqueue(encoder.encode(`data: ${JSON.stringify(token)}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    } catch {
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    }
  },
});
return new Response(readableStream, {
  headers: {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  },
});
```

### 9. Error Handling

No global error handler. Each handler catches at the DB/business logic level only where specific status codes are needed (404 not-found, 400 FK violation, etc.). Unhandled throws bubble to Next.js's built-in 500 response. This mirrors Express behavior.

---

## Shared Utilities

| File | Exports | Used by |
|---|---|---|
| `lib/auth/require.ts` | `requireAuth()`, `requireAdmin()`, `isAuthError()` | roles, users, ai/chat route handlers |
| `lib/auth/session.ts` | `getSession()` | `require.ts` internals |
| `lib/compute-row.ts` | `computeRow(input): ComputeRowResult` | bills, buying-houses route handlers |
| `lib/ai-context.ts` | `buildContext(): Promise<string>` | ai/chat route handler |

---

## Route Inventory (41 handlers)

### Infrastructure
| File | Methods | Auth |
|---|---|---|
| `app/api/healthz/route.ts` | GET | public |

### Reference Data
| File | Methods | Auth |
|---|---|---|
| `app/api/cost-models/route.ts` | GET, POST | public |
| `app/api/cost-models/[id]/route.ts` | DELETE | public |
| `app/api/payment-terms/route.ts` | GET, POST | public |
| `app/api/payment-terms/[id]/route.ts` | DELETE | public |
| `app/api/roles/route.ts` | GET (requireAuth), POST (requireAdmin) | mixed |
| `app/api/roles/[name]/route.ts` | DELETE | requireAdmin |

### Clients
| File | Methods | Auth |
|---|---|---|
| `app/api/clients/route.ts` | GET, POST | public |
| `app/api/clients/[id]/route.ts` | GET, PATCH, DELETE | public |
| `app/api/clients/[id]/events/route.ts` | GET, POST | public |
| `app/api/clients/[id]/events/[eventId]/route.ts` | PATCH, DELETE | public |

### Partners
| File | Methods | Auth |
|---|---|---|
| `app/api/partners/route.ts` | GET, POST | public |
| `app/api/partners/[id]/route.ts` | GET, PATCH, DELETE | public |
| `app/api/partners/[id]/billing-records/route.ts` | GET, POST | public |
| `app/api/partners/[id]/billing-records/[recordId]/route.ts` | PATCH, DELETE | public |
| `app/api/partners/[id]/clients/route.ts` | GET, POST | public |
| `app/api/partners/[id]/clients/[clientId]/route.ts` | DELETE | public |
| `app/api/partners/[id]/clients/[clientId]/events/[eventId]/payout/route.ts` | PUT | public |

### Buying Houses & Billing
| File | Methods | Auth |
|---|---|---|
| `app/api/buying-houses/route.ts` | GET, POST | public |
| `app/api/buying-houses/[id]/route.ts` | GET, PATCH, DELETE | public |
| `app/api/buying-houses/[id]/analytics/route.ts` | GET | public |
| `app/api/buying-houses/[id]/billing-records/route.ts` | GET | public |
| `app/api/billing-records/route.ts` | GET | public |

### Analytics & Transactions
| File | Methods | Auth |
|---|---|---|
| `app/api/analytics/dashboard/route.ts` | GET | public |
| `app/api/analytics/profit-over-time/route.ts` | GET | public |
| `app/api/analytics/by-client/route.ts` | GET | public |
| `app/api/analytics/by-platform/route.ts` | GET | public |
| `app/api/analytics/alerts/route.ts` | GET | public |
| `app/api/transactions/route.ts` | GET, POST | public |
| `app/api/transactions/[id]/route.ts` | DELETE | public |

### Uploads
| File | Methods | Auth |
|---|---|---|
| `app/api/upload/route.ts` | POST | public |
| `app/api/uploads/payment-attachment/route.ts` | POST | public |

### Users
| File | Methods | Auth |
|---|---|---|
| `app/api/users/route.ts` | GET, POST | requireAdmin |
| `app/api/users/[email]/route.ts` | DELETE | requireAdmin |

### Finance
| File | Methods | Auth |
|---|---|---|
| `app/api/bills/route.ts` | GET, POST | public |
| `app/api/bills/[id]/route.ts` | GET, PATCH, DELETE | public |
| `app/api/payments/route.ts` | GET, POST | public |
| `app/api/payments/[id]/route.ts` | PATCH, DELETE | public |
| `app/api/cost-resources/route.ts` | GET, POST | public |
| `app/api/cost-resources/[id]/route.ts` | PATCH, DELETE | public |

### AI
| File | Methods | Auth |
|---|---|---|
| `app/api/ai/chat/route.ts` | POST | requireAuth + Upstash rate limit (20 req/min per user) |

---

## Environment Variables Required

| Variable | Used by |
|---|---|
| `GROQ` | `app/api/ai/chat/route.ts` |
| `UPSTASH_REDIS_REST_URL` | `app/api/ai/chat/route.ts` (rate limiting) |
| `UPSTASH_REDIS_REST_TOKEN` | `app/api/ai/chat/route.ts` (rate limiting) |
| `NEXT_PUBLIC_SUPABASE_URL` | `app/api/uploads/payment-attachment/route.ts` |
| `SUPABASE_SERVICE_ROLE_KEY` | `app/api/uploads/payment-attachment/route.ts` |

---

## Verification Checklist

- [ ] All 45 route files exist under `app/api/`
- [ ] Every file exports `export const runtime = "nodejs"`
- [ ] Only roles/users/ai routes use auth helpers
- [ ] AI chat uses Upstash Redis rate limiter (not in-memory Map)
- [ ] Async params awaited in all dynamic routes
- [ ] `pnpm typecheck` passes with zero errors
- [ ] Global billing-records GET includes joins for platformName, buyingHouseName, clientName, costModelName
