import { NextResponse } from "next/server";
import Groq from "groq-sdk";
import { requireAuth, isAuthError } from "@/lib/auth/require";
import { buildContext } from "@/lib/ai-context";

export const runtime = "nodejs";

let _groq: Groq | null = null;
function getGroq(): Groq {
  if (!_groq) _groq = new Groq({ apiKey: process.env["GROQ"]! });
  return _groq;
}

const rateLimitMap = new Map<number, { count: number; resetAt: number }>();

function checkLocalRateLimit(userId: number): boolean {
  const now = Date.now();
  const window = 60 * 1000;
  const entry = rateLimitMap.get(userId);
  if (!entry || now > entry.resetAt) { rateLimitMap.set(userId, { count: 1, resetAt: now + window }); return true; }
  if (entry.count >= 20) return false;
  entry.count++;
  return true;
}

export async function POST(req: Request): Promise<Response> {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const groqKey = process.env["GROQ"];
  if (!groqKey) return NextResponse.json({ error: "AI service not configured" }, { status: 500 });

  if (!checkLocalRateLimit(auth.user.sub)) {
    return NextResponse.json({ error: "Too many requests. Please wait before sending another message." }, { status: 429 });
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
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "system", content: systemPrompt }, ...trimmedHistory, { role: "user", content: message.trim() }],
      stream: true, temperature: 0.3, max_tokens: 300,
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
  } catch {
    return NextResponse.json({ error: "AI service unavailable" }, { status: 500 });
  }
}
