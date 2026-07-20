import { NextResponse } from "next/server";
import Groq from "groq-sdk";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { and, gte, lte, sql } from "drizzle-orm";
import { db, transactionsTable } from "@workspace/db";
import { GetAiInsightsResponse } from "@workspace/api-zod";
import { requireAuth, isAuthError } from "@/lib/auth/require";
import { percentDelta, marginPct } from "@/lib/analytics/metrics";

export const runtime = "nodejs";

const DAY_MS = 24 * 60 * 60 * 1000;
const MODEL = "llama-3.1-8b-instant";

let _groq: Groq | null = null;
function getGroq(): Groq {
  if (!_groq) _groq = new Groq({ apiKey: process.env["GROQ"]! });
  return _groq;
}

let _ratelimit: Ratelimit | null = null;
function getRatelimit(): Ratelimit {
  if (!_ratelimit) {
    _ratelimit = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(20, "1 m"),
    });
  }
  return _ratelimit;
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type PeriodTotals = { revenue: number; cost: number; profit: number };

async function sumPeriod(dateFrom: string, dateTo: string): Promise<PeriodTotals> {
  const [row] = await db.select({
    revenue: sql<string>`coalesce(sum(${transactionsTable.spend}), 0)`,
    cost: sql<string>`coalesce(sum(${transactionsTable.cost}), 0)`,
    profit: sql<string>`coalesce(sum(${transactionsTable.profit}), 0)`,
  }).from(transactionsTable)
    .where(and(gte(transactionsTable.date, dateFrom), lte(transactionsTable.date, dateTo)));

  return {
    revenue: parseFloat(row?.revenue ?? "0"),
    cost: parseFloat(row?.cost ?? "0"),
    profit: parseFloat(row?.profit ?? "0"),
  };
}

type RawInsight = { title: string; detail: string; sentiment: "positive" | "negative" | "neutral" };

function coerceInsights(parsed: unknown): RawInsight[] {
  if (!Array.isArray(parsed)) return [];
  const out: RawInsight[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    if (typeof rec["title"] !== "string" || typeof rec["detail"] !== "string") continue;
    const sentiment = rec["sentiment"] === "positive" || rec["sentiment"] === "negative" || rec["sentiment"] === "neutral"
      ? rec["sentiment"]
      : "neutral";
    out.push({ title: rec["title"], detail: rec["detail"], sentiment });
    if (out.length >= 4) break;
  }
  return out;
}

function parseCompletion(text: string): RawInsight[] {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return coerceInsights(JSON.parse(cleaned));
  } catch {
    return [];
  }
}

export async function GET(): Promise<Response> {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const groqKey = process.env["GROQ"];
  if (!groqKey) return NextResponse.json([]);

  try {
    const { success } = await getRatelimit().limit(`ai-insights:${auth.user.sub}`);
    if (!success) return NextResponse.json([]);

    const now = new Date();
    const currentEnd = toIsoDate(now);
    const currentStart = toIsoDate(new Date(now.getTime() - 29 * DAY_MS));
    const priorEndDate = new Date(now.getTime() - 30 * DAY_MS);
    const priorEnd = toIsoDate(priorEndDate);
    const priorStart = toIsoDate(new Date(priorEndDate.getTime() - 29 * DAY_MS));

    const [current, prior] = await Promise.all([
      sumPeriod(currentStart, currentEnd),
      sumPeriod(priorStart, priorEnd),
    ]);

    const currentMargin = marginPct(current.profit, current.revenue);
    const priorMargin = marginPct(prior.profit, prior.revenue);

    const stats = {
      currentPeriod: { from: currentStart, to: currentEnd, ...current, marginPct: currentMargin },
      priorPeriod: { from: priorStart, to: priorEnd, ...prior, marginPct: priorMargin },
      changes: {
        revenuePercentDelta: percentDelta(current.revenue, prior.revenue),
        profitPercentDelta: percentDelta(current.profit, prior.profit),
        marginPercentDelta: percentDelta(currentMargin, priorMargin),
      },
    };

    const systemPrompt =
      "You are a concise ad-operations financial analyst. Given period metrics, output 3-4 short executive insights " +
      "about what changed and likely why. Respond with ONLY a JSON array of objects " +
      '{"title": string (<=6 words), "detail": string (<=20 words), "sentiment": "positive"|"negative"|"neutral"}. ' +
      "No prose, no markdown fences.";

    const completion = await getGroq().chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(stats) },
      ],
      temperature: 0.4,
      max_tokens: 400,
    });

    const text = completion.choices[0]?.message?.content ?? "";
    const insights = parseCompletion(text);

    return NextResponse.json(GetAiInsightsResponse.parse(insights));
  } catch {
    return NextResponse.json([]);
  }
}
