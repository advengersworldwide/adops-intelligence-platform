# AI Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a floating AI chat assistant backed by Groq (`llama-3.3-70b-versatile`) that answers questions about live AdOps data, accessible from every page with multi-turn streaming conversation.

**Architecture:** The frontend `FloatingChat` component (rendered in Layout) sends `{ message, history }` to `POST /api/ai/chat`. The server runs 5 parallel DB queries to build a compact data snapshot, injects it as the system prompt, then streams the Groq response as SSE. The frontend reads the stream token-by-token and appends to the last message in real time.

**Tech Stack:** groq-sdk, Groq `llama-3.3-70b-versatile`, Express SSE, React ReadableStream, Drizzle ORM, Tailwind CSS, lucide-react

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `artifacts/api-server/package.json` | Modify | Add `groq-sdk` dependency |
| `artifacts/api-server/src/index.ts` | Modify | Add `GROQ` env var startup validation |
| `artifacts/api-server/src/lib/context.ts` | Create | `buildContext()` — 5 parallel DB queries → system prompt string |
| `artifacts/api-server/src/routes/ai.ts` | Create | `POST /api/ai/chat` — validate, build context, stream Groq response as SSE |
| `artifacts/api-server/src/routes/index.ts` | Modify | Mount `aiRouter` |
| `artifacts/adops/src/components/FloatingChat.tsx` | Create | Floating button + chat panel + SSE streaming UI |
| `artifacts/adops/src/components/layout/Layout.tsx` | Modify | Render `<FloatingChat />` so it persists across all pages |

---

## Task 1: Install groq-sdk and add startup validation

**Files:**
- Modify: `artifacts/api-server/package.json`
- Modify: `artifacts/api-server/src/index.ts`

- [ ] **Step 1: Install groq-sdk**

```bash
cd artifacts/api-server
pnpm add groq-sdk
cd ../..
pnpm install
```

Expected: no errors, `groq-sdk` appears in `artifacts/api-server/package.json` dependencies.

- [ ] **Step 2: Add GROQ env var check to index.ts**

Open `artifacts/api-server/src/index.ts`. The file currently reads PORT and JWT_SECRET near the top. Add the GROQ check immediately after the `jwtSecret` check. The full file should be:

```typescript
import app from "./app";
import { logger } from "./lib/logger";
import { seedDefaults } from "./lib/seed";

const rawPort = process.env["PORT"];
const jwtSecret = process.env["JWT_SECRET"];
const groqKey = process.env["GROQ"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}
if (!jwtSecret) {
  throw new Error("JWT_SECRET environment variable is required but was not provided.");
}
if (!groqKey) {
  throw new Error("GROQ environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

seedDefaults()
  .then(() => {
    app.listen(port, (err) => {
      if (err) {
        logger.error({ err }, "Error listening on port");
        process.exit(1);
      }
      logger.info({ port }, "Server listening");
    });
  })
  .catch((err) => {
    logger.error({ err }, "Failed to seed database");
    process.exit(1);
  });
```

- [ ] **Step 3: Verify GROQ is set in local .env**

Check that `.env` contains `GROQ="gsk_..."`. If not, add it. The file is git-ignored so this is safe.

- [ ] **Step 4: Typecheck**

```bash
pnpm run typecheck
```
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/package.json artifacts/api-server/src/index.ts pnpm-lock.yaml
git commit -m "deps(api-server): add groq-sdk; require GROQ env var at startup"
```

---

## Task 2: Create buildContext()

**Files:**
- Create: `artifacts/api-server/src/lib/context.ts`

This file has one export: `buildContext()`. It runs 5 parallel DB queries and returns the system prompt string with the current AdOps snapshot.

- [ ] **Step 1: Create the file**

```typescript
import { eq, gte, sum } from "drizzle-orm";
import {
  db,
  clientsTable,
  platformsTable,
  campaignsTable,
  transactionsTable,
} from "@workspace/db";

export async function buildContext(): Promise<string> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const dateStr = thirtyDaysAgo.toISOString().split("T")[0];

  const [clients, platforms, campaigns, txAgg, campaignPerf] = await Promise.all([
    db.select({ name: clientsTable.name, pricingModel: clientsTable.pricingModel })
      .from(clientsTable),

    db.select({ name: platformsTable.name })
      .from(platformsTable),

    db.select({
      id: campaignsTable.id,
      name: campaignsTable.name,
      clientName: clientsTable.name,
      platformName: platformsTable.name,
    })
      .from(campaignsTable)
      .leftJoin(clientsTable, eq(campaignsTable.clientId, clientsTable.id))
      .leftJoin(platformsTable, eq(campaignsTable.platformId, platformsTable.id)),

    db.select({
      totalSpend: sum(transactionsTable.spend),
      totalCost: sum(transactionsTable.cost),
      totalProfit: sum(transactionsTable.profit),
    })
      .from(transactionsTable)
      .where(gte(transactionsTable.date, dateStr)),

    db.select({
      campaignId: transactionsTable.campaignId,
      totalSpend: sum(transactionsTable.spend),
      totalProfit: sum(transactionsTable.profit),
    })
      .from(transactionsTable)
      .where(gte(transactionsTable.date, dateStr))
      .groupBy(transactionsTable.campaignId),
  ]);

  const fmt = (n: number) => `$${n.toFixed(2)}`;
  const pct = (n: number) => `${n.toFixed(1)}%`;

  const totalSpend = parseFloat(txAgg[0]?.totalSpend ?? "0");
  const totalCost = parseFloat(txAgg[0]?.totalCost ?? "0");
  const totalProfit = parseFloat(txAgg[0]?.totalProfit ?? "0");
  const overallMargin = totalSpend > 0 ? (totalProfit / totalSpend) * 100 : 0;

  const campaignNameMap = new Map(campaigns.map(c => [c.id, c.name]));

  const perfWithMargin = campaignPerf.map(c => {
    const spend = parseFloat(c.totalSpend ?? "0");
    const profit = parseFloat(c.totalProfit ?? "0");
    const margin = spend > 0 ? (profit / spend) * 100 : 0;
    return { name: campaignNameMap.get(c.campaignId) ?? `Campaign ${c.campaignId}`, profit, margin };
  });

  const top5 = [...perfWithMargin].sort((a, b) => b.profit - a.profit).slice(0, 5);
  const bottom5 = [...perfWithMargin].sort((a, b) => a.margin - b.margin).slice(0, 5);
  const alerts = perfWithMargin.filter(c => c.profit < 0 || c.margin < 10);

  const clientList = clients.length
    ? clients.map(c => `${c.name} (${c.pricingModel})`).join(", ")
    : "None";
  const platformList = platforms.length
    ? platforms.map(p => p.name).join(", ")
    : "None";
  const campaignList = campaigns.length
    ? campaigns.map(c => `${c.name} [${c.clientName ?? "?"}/${c.platformName ?? "?"}]`).join(", ")
    : "None";
  const top5List = top5.length
    ? top5.map(c => `${c.name}: ${fmt(c.profit)}`).join(", ")
    : "No transaction data";
  const bottom5List = bottom5.length
    ? bottom5.map(c => `${c.name}: ${pct(c.margin)}`).join(", ")
    : "No transaction data";
  const alertList = alerts.length
    ? alerts.map(c => `${c.name} (profit: ${fmt(c.profit)}, margin: ${pct(c.margin)})`).join("; ")
    : "None";

  return `You are an AI assistant for AdOps Intelligence (Advengers Worldwide).
You have access to real-time advertising operations data. Today: ${new Date().toISOString().split("T")[0]}.

CLIENTS (${clients.length}): ${clientList}
PLATFORMS (${platforms.length}): ${platformList}
CAMPAIGNS (${campaigns.length} total): ${campaignList}
LAST 30 DAYS:
  Spend: ${fmt(totalSpend)} | Cost: ${fmt(totalCost)} | Profit: ${fmt(totalProfit)} | Margin: ${pct(overallMargin)}
TOP 5 CAMPAIGNS BY PROFIT: ${top5List}
BOTTOM 5 CAMPAIGNS BY MARGIN: ${bottom5List}
ACTIVE ALERTS: ${alertList}

Answer questions about this data concisely and accurately.
Only discuss topics relevant to advertising operations and this data.
Write in plain professional prose. Do not use markdown formatting, bullet symbols,
asterisks, pound signs, or emojis. Structure responses with clear sentences and
paragraphs only. Keep answers concise and business-appropriate.`;
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm run typecheck
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/lib/context.ts
git commit -m "feat(api-server): add buildContext() for AI assistant data snapshot"
```

---

## Task 3: Create POST /api/ai/chat route

**Files:**
- Create: `artifacts/api-server/src/routes/ai.ts`

- [ ] **Step 1: Create the file**

```typescript
import { Router, type IRouter } from "express";
import Groq from "groq-sdk";
import { requireAuth } from "../middlewares/auth";
import { buildContext } from "../lib/context";

const router: IRouter = Router();

router.post("/ai/chat", requireAuth, async (req, res): Promise<void> => {
  const groqKey = process.env["GROQ"];
  if (!groqKey) {
    res.status(500).json({ error: "AI service not configured" });
    return;
  }

  const { message, history } = req.body;
  if (!message || typeof message !== "string" || message.trim() === "") {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const MAX_HISTORY = 20;
  const trimmedHistory: { role: "user" | "assistant"; content: string }[] = Array.isArray(history)
    ? (history as unknown[])
        .filter(
          (m): m is { role: "user" | "assistant"; content: string } =>
            typeof m === "object" &&
            m !== null &&
            (("role" in m && m.role === "user") || ("role" in m && m.role === "assistant")) &&
            "content" in m &&
            typeof m.content === "string",
        )
        .slice(-MAX_HISTORY)
    : [];

  try {
    const systemPrompt = await buildContext();
    const groq = new Groq({ apiKey: groqKey });

    const stream = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        ...trimmedHistory,
        { role: "user", content: message.trim() },
      ],
      stream: true,
      temperature: 0.3,
    });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content ?? "";
      if (token) {
        res.write(`data: ${JSON.stringify(token)}\n\n`);
      }
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch {
    if (!res.headersSent) {
      res.status(500).json({ error: "AI service unavailable" });
    } else {
      res.write("data: [DONE]\n\n");
      res.end();
    }
  }
});

export default router;
```

- [ ] **Step 2: Typecheck**

```bash
pnpm run typecheck
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/routes/ai.ts
git commit -m "feat(api-server): POST /api/ai/chat — Groq streaming with live data context"
```

---

## Task 4: Mount aiRouter

**Files:**
- Modify: `artifacts/api-server/src/routes/index.ts`

- [ ] **Step 1: Add aiRouter import and mount**

Open `artifacts/api-server/src/routes/index.ts`. Add one import line after the existing imports and one `router.use()` call. The full file should be:

```typescript
import { Router, type IRouter } from "express";
import healthRouter from "./health";
import clientsRouter from "./clients";
import platformsRouter from "./platforms";
import campaignsRouter from "./campaigns";
import transactionsRouter from "./transactions";
import analyticsRouter from "./analytics";
import uploadRouter from "./upload";
import rolesRouter from "./roles";
import usersRouter from "./users";
import aiRouter from "./ai";

const router: IRouter = Router();

router.use(healthRouter);
router.use(clientsRouter);
router.use(platformsRouter);
router.use(campaignsRouter);
router.use(transactionsRouter);
router.use(analyticsRouter);
router.use(uploadRouter);
router.use(rolesRouter);
router.use(usersRouter);
router.use(aiRouter);

export default router;
```

- [ ] **Step 2: Typecheck**

```bash
pnpm run typecheck
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add artifacts/api-server/src/routes/index.ts
git commit -m "feat(api-server): mount AI chat route"
```

---

## Task 5: Create FloatingChat component

**Files:**
- Create: `artifacts/adops/src/components/FloatingChat.tsx`

- [ ] **Step 1: Create the file**

```typescript
import { useState, useRef, useEffect } from "react";
import { MessageCircle, X, Trash2, Send } from "lucide-react";
import { getToken } from "@/lib/auth";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function FloatingChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    const history = [...messages];
    setMessages([...history, { role: "user", content: text }, { role: "assistant", content: "" }]);
    setInput("");
    setIsStreaming(true);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken() ?? ""}`,
        },
        body: JSON.stringify({ message: text, history }),
      });

      if (!res.ok || !res.body) {
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = {
            ...updated[updated.length - 1],
            content: "Sorry, I could not reach the AI service. Please try again.",
          };
          return updated;
        });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") break;
          try {
            const token = JSON.parse(data) as string;
            setMessages(prev => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...updated[updated.length - 1],
                content: updated[updated.length - 1].content + token,
              };
              return updated;
            });
          } catch {
            // malformed SSE chunk, skip
          }
        }
      }
    } catch {
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          content: "Sorry, I could not reach the AI service. Please try again.",
        };
        return updated;
      });
    } finally {
      setIsStreaming(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {isOpen && (
        <div className="flex flex-col w-80 h-96 rounded-2xl border border-border bg-card shadow-xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <span className="text-sm font-semibold text-foreground">AdOps Assistant</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setMessages([])}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                title="Clear conversation"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.length === 0 && (
              <p className="text-xs text-muted-foreground text-center pt-6 leading-relaxed">
                Ask anything about your campaigns, clients, margins, or performance.
              </p>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  }`}
                >
                  {msg.content ? (
                    msg.content
                  ) : isStreaming && i === messages.length - 1 ? (
                    <span className="inline-flex gap-0.5">
                      <span className="w-1 h-1 rounded-full bg-current animate-bounce [animation-delay:0ms]" />
                      <span className="w-1 h-1 rounded-full bg-current animate-bounce [animation-delay:150ms]" />
                      <span className="w-1 h-1 rounded-full bg-current animate-bounce [animation-delay:300ms]" />
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-t border-border">
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isStreaming}
              placeholder={isStreaming ? "Responding..." : "Ask a question..."}
              className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
            />
            <button
              onClick={send}
              disabled={isStreaming || !input.trim()}
              className="p-1.5 rounded-lg bg-primary text-primary-foreground disabled:opacity-40 hover:opacity-90 transition-opacity"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Floating button */}
      <button
        onClick={() => setIsOpen(o => !o)}
        className="h-12 w-12 rounded-full bg-primary text-primary-foreground shadow-lg hover:opacity-90 transition-opacity flex items-center justify-center"
        title={isOpen ? "Close assistant" : "Open AI assistant"}
      >
        {isOpen ? <X className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm run typecheck
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add artifacts/adops/src/components/FloatingChat.tsx
git commit -m "feat(adops): FloatingChat component with SSE streaming"
```

---

## Task 6: Wire FloatingChat into Layout

**Files:**
- Modify: `artifacts/adops/src/components/layout/Layout.tsx`

- [ ] **Step 1: Update Layout.tsx**

The current `Layout.tsx` renders a sidebar + topbar + main. Add `FloatingChat` so it persists across all pages. Replace the entire file with:

```typescript
import { useState, useEffect } from "react";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import FloatingChat from "../FloatingChat";

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 768) {
        setSidebarOpen(false);
      } else {
        setSidebarOpen(true);
      }
    };

    handleResize();

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden backdrop-blur-xs transition-opacity cursor-pointer"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar open={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>

      <FloatingChat />
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm run typecheck
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add artifacts/adops/src/components/layout/Layout.tsx
git commit -m "feat(adops): render FloatingChat in Layout for all-page access"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| llama-3.3-70b-versatile model | Task 3 (`model: "llama-3.3-70b-versatile"`) |
| GROQ env var startup validation | Task 1 (index.ts) |
| 5 parallel DB queries (clients, platforms, campaigns, tx aggregates, campaign perf) | Task 2 (buildContext) |
| System prompt with plain-prose instruction | Task 2 (return string in buildContext) |
| History truncation to 20 messages | Task 3 (`slice(-MAX_HISTORY)`) |
| SSE streaming response | Task 3 (res.write loop) |
| `POST /api/ai/chat` protected by requireAuth | Task 3 |
| aiRouter mounted | Task 4 |
| Floating button fixed bottom-right | Task 5 |
| w-80 h-96 panel | Task 5 |
| Multi-turn conversation state | Task 5 (messages state) |
| SSE ReadableStream reading | Task 5 (send() reader loop) |
| Auto-scroll to bottom | Task 5 (useEffect + messagesEndRef) |
| Clear chat button | Task 5 (Trash2 onClick) |
| Input disabled while streaming | Task 5 (disabled={isStreaming}) |
| Error fallback message | Task 5 (catch blocks) |
| FloatingChat in Layout for all pages | Task 6 |

**Placeholder scan:** No TBD/TODO/placeholder text. ✅

**Type consistency:**
- `Message` interface defined in Task 5, used only in Task 5. ✅
- `buildContext()` returns `Promise<string>`, consumed in Task 3. ✅
- SSE format `data: ${JSON.stringify(token)}\n\n` in Task 3, parsed with `JSON.parse(data)` in Task 5. ✅
- `getToken()` imported from `@/lib/auth` in Task 5 — exported in the security branch. ✅
