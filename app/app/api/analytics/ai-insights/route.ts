import { NextResponse } from "next/server";
import Groq from "groq-sdk";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { and, gte, lte } from "drizzle-orm";
import { db, billingRecordsTable } from "@workspace/db";
import { GetAiInsightsResponse } from "@workspace/api-zod";
import { requirePermission, isAuthError } from "@/lib/auth/require";
import { percentDelta, marginPct } from "@/lib/analytics/metrics";
import { aggregateTotals, type AggRecord } from "@/lib/analytics/billing-records-agg";
import { monthOf } from "@/lib/analytics/record-filters";

export const runtime = "nodejs";

const DAY_MS = 24 * 60 * 60 * 1000;
const MODEL = process.env.GROQ_INSIGHTS_MODEL || "groq/compound";

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
      prefix: "rl:ai:insights",
    });
    return _ratelimit;
  } catch {
    return null;
  }
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type PeriodTotals = { revenue: number; cost: number; profit: number };

async function sumPeriod(dateFrom: string, dateTo: string): Promise<PeriodTotals> {
  const periodFrom = monthOf(dateFrom)!;
  const periodTo = monthOf(dateTo)!;
  const recs = await db.select().from(billingRecordsTable)
    .where(and(gte(billingRecordsTable.period, periodFrom), lte(billingRecordsTable.period, periodTo)));

  const totals = aggregateTotals(recs as AggRecord[]);
  return { revenue: totals.revenue, cost: totals.cost, profit: totals.profit };
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
  const auth = await requirePermission("analytics:view");
  if (isAuthError(auth)) return auth;

  const groqKey = process.env.GROQ || process.env.GROQ_API_KEY;
  if (!groqKey) return NextResponse.json([]);

  try {
    const limiter = getRatelimit();
    if (limiter) {
      const { success } = await limiter.limit(`ai-insights:${auth.user.sub}`);
      if (!success) return NextResponse.json([]);
    }

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
      max_tokens: 600,
    });

    const text = completion.choices[0]?.message?.content ?? "";
    const insights = parseCompletion(text);

    return NextResponse.json(GetAiInsightsResponse.parse(insights));
  } catch {
    return NextResponse.json([]);
  }
}
