# AI Assistant Feature Design

**Date:** 2026-05-31
**Status:** Approved

---

## Goal

Add a floating AI chat assistant powered by Groq (`llama-3.3-70b-versatile`) that answers questions about the user's live AdOps data. Accessible from every page, multi-turn conversation, streaming responses.

---

## Architecture

```
Browser                    API Server              Groq
─────────────────────────────────────────────────────────
FloatingChat component
  { message, history }
         ──────────────────►  POST /api/ai/chat
                                requireAuth
                                buildContext() — 5 parallel DB queries
                                Groq SDK stream
                                           ──────────────►
                                           ◄── SSE chunks ─
                                pipe as text/event-stream
         ◄── SSE text chunks ──
  append tokens to last message in real time
```

---

## Backend

### New file: `artifacts/api-server/src/routes/ai.ts`

**Endpoint:** `POST /api/ai/chat`
- Protected by `requireAuth`
- Request body: `{ message: string; history: { role: "user" | "assistant"; content: string }[] }`
- Response: `Content-Type: text/event-stream` SSE stream, each chunk `data: <token>\n\n`, terminated with `data: [DONE]\n\n`

**Context assembly — `buildContext()`:**

Runs 5 parallel DB queries, assembles a compact text block injected as the system message:

```
You are an AI assistant for AdOps Intelligence (Advengers Worldwide).
You have access to real-time advertising operations data. Today: {ISO date}.

CLIENTS ({n}): {comma-separated names with pricing model}
PLATFORMS ({n}): {comma-separated names}
CAMPAIGNS ({n} total): {comma-separated names with client/platform}
LAST 30 DAYS:
  Spend: ${total} | Cost: ${total} | Profit: ${total} | Margin: {%}
TOP 5 CAMPAIGNS BY PROFIT: {name}: ${profit}, ...
BOTTOM 5 CAMPAIGNS BY MARGIN: {name}: {margin}%, ...
ACTIVE ALERTS: {list of campaign names with issue description, or "None"}

Answer questions about this data concisely and accurately.
Only discuss topics relevant to advertising operations and this data.
```

**History truncation:** Keep last 20 messages (10 turns) before the new user message to stay within the model's context window. Drop oldest messages first.

**Groq model:** `llama-3.3-70b-versatile`

**Rate limits (free tier):** 30 RPM, 6,000 TPM, 500,000 tokens/day — sufficient for an internal tool with normal usage.

**Error handling:**
- Groq API error → `500` with `{ error: "AI service unavailable" }` (no details leaked)
- Missing GROQ env var at startup → server fails fast with a clear error message (same pattern as JWT_SECRET)

### Modified: `artifacts/api-server/src/routes/index.ts`
- Import and mount `aiRouter`

### Modified: `artifacts/api-server/package.json`
- Add `groq-sdk`

---

## Frontend

### New file: `artifacts/adops/src/components/FloatingChat.tsx`

**State:**
```typescript
messages: { role: "user" | "assistant"; content: string }[]
input: string
isOpen: boolean
isStreaming: boolean
```

**Layout (fixed, bottom-right of viewport):**
```
When closed:  ● floating button (chat bubble icon, primary color)
When open:    ┌─────────────────────────────┐
              │ AdOps Assistant  [🗑] [✕]  │  ← header
              ├─────────────────────────────┤
              │                             │
              │  [user message]             │  ← scrollable
              │        [assistant reply]    │     message list
              │  [user message]             │
              │        [▌ streaming...]     │
              │                             │
              ├─────────────────────────────┤
              │ [input field]          [→]  │  ← input row
              └─────────────────────────────┘
```

Panel dimensions: `w-80 h-96` (320×384px), fixed `bottom-6 right-6`.

**Send flow:**
1. Append `{ role: "user", content: input }` to messages
2. Append `{ role: "assistant", content: "" }` placeholder
3. Set `isStreaming = true`, clear input
4. `fetch("POST /api/ai/chat", { message, history: messages.slice(0, -1) })`
5. Read `response.body` as `ReadableStream`, decode with `TextDecoder`
6. Parse `data: <token>` SSE lines, append each token to the last message's `content`
7. On stream close or `data: [DONE]`: set `isStreaming = false`
8. Auto-scroll the message list to bottom on every token

**Clear chat:** Trash icon in header resets messages to `[]`.

**Input disabled while `isStreaming === true`.**

**Error state:** If fetch fails, replace the empty assistant placeholder with `"Sorry, I couldn't reach the AI service. Please try again."` and set `isStreaming = false`.

### Modified: `artifacts/adops/src/components/layout/Layout.tsx`
- Render `<FloatingChat />` inside the layout root so it persists across page navigation

---

## Data Queries (buildContext)

All 5 run in parallel via `Promise.all`:

| Query | Purpose |
|---|---|
| `SELECT id, name, pricingModel FROM clients` | Client roster |
| `SELECT id, name FROM platforms` | Platform roster |
| `SELECT c.name, cl.name AS client, p.name AS platform FROM campaigns c JOIN clients cl JOIN platforms p` | Campaign roster |
| `SELECT SUM(spend), SUM(cost), SUM(profit) FROM transactions WHERE date >= now()-30d` + top/bottom 5 by margin | Financial summary |
| Campaigns where latest transaction profit < 0 OR margin < 10% | Active alerts |

---

## Environment

`GROQ` env var already present in `.env` and documented in `.env.example`. The startup check (same pattern as `JWT_SECRET`) should be added to `index.ts`.

---

## Out of Scope

- Persisting conversation history to the database (browser session only)
- Tool use / function calling (Phase 2 upgrade path)
- Email notifications (separate feature, separate spec)
- Business route auth protection (tracked in PR #1 notes)
