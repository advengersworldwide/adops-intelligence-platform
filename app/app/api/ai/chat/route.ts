import { NextResponse } from "next/server";
import Groq from "groq-sdk";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { requireAuth, isAuthError } from "@/lib/auth/require";
import { buildContext } from "@/lib/ai-context";

export const runtime = "nodejs";

const MODEL = process.env.GROQ_CHAT_MODEL || "openai/gpt-oss-120b";

let _groq: Groq | null = null;
function getGroq(): Groq {
  if (!_groq) {
    const key = process.env.GROQ || process.env.GROQ_API_KEY;
    _groq = new Groq({ apiKey: key });
  }
  return _groq;
}

let _ratelimit: Ratelimit | null = null;
function getRatelimit(): Ratelimit | null {
  if (_ratelimit) return _ratelimit;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const redis = new Redis({ url, token });
    _ratelimit = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(20, "1 m"),
      prefix: "rl:ai:chat",
    });
    return _ratelimit;
  } catch {
    return null;
  }
}

export async function POST(req: Request): Promise<Response> {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const groqKey = process.env.GROQ || process.env.GROQ_API_KEY;
  if (!groqKey) return NextResponse.json({ error: "AI service not configured" }, { status: 500 });

  try {
    const limiter = getRatelimit();
    if (limiter) {
      const { success } = await limiter.limit(`ai:${auth.user.sub}`);
      if (!success) {
        return NextResponse.json({ error: "Too many requests. Please wait before sending another message." }, { status: 429 });
      }
    }
  } catch (err) {
    console.warn("[AI Chat] Rate limit check failed, failing open:", err);
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const { message, history } = body as { message?: unknown; history?: unknown };

  if (!message || typeof message !== "string" || message.trim() === "") return NextResponse.json({ error: "message is required" }, { status: 400 });
  if (message.length > 4000) return NextResponse.json({ error: "Message is too long. Please keep messages under 4000 characters." }, { status: 400 });

  const MAX_HISTORY = 20;
  const trimmedHistory: { role: "user" | "assistant"; content: string }[] = Array.isArray(history)
    ? (history as unknown[]).filter((m): m is { role: "user" | "assistant"; content: string } =>
        typeof m === "object" && m !== null && "role" in m && (m.role === "user" || m.role === "assistant") && "content" in m && typeof m.content === "string"
      ).map(m => ({ ...m, content: m.content.slice(0, 2000) })).slice(-MAX_HISTORY)
    : [];

  try {
    const systemPrompt = await buildContext();
    const stream = await getGroq().chat.completions.create({
      model: MODEL,
      messages: [{ role: "system", content: systemPrompt }, ...trimmedHistory, { role: "user", content: message.trim() }],
      stream: true,
      temperature: 0.3,
      max_tokens: 500,
    });

    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
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
      headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no" },
    });
  } catch (err) {
    console.error("[AI Chat Error]:", err);
    return NextResponse.json({ error: "AI service unavailable. Please try again." }, { status: 500 });
  }
}
