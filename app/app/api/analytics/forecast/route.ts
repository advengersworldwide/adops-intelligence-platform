import { NextResponse } from "next/server";
import { and } from "drizzle-orm";
import { db, billingRecordsTable } from "@workspace/db";
import { GetForecastQueryParams, GetForecastResponse } from "@workspace/api-zod";
import { parseIdList } from "@/lib/analytics/parse-params";
import { buildRecordConditions, monthOf } from "@/lib/analytics/record-filters";
import { aggregateBy, type AggRecord } from "@/lib/analytics/billing-records-agg";
import { linearForecast } from "@/lib/analytics/forecast";

export const runtime = "nodejs";

const METRIC_KEYS = ["revenue", "cost", "profit"] as const;
type Metric = (typeof METRIC_KEYS)[number];

/** Parse a "YYYY-MM" period into an absolute month index (year*12 + month). */
function periodToIndex(period: string): number {
  const [y, m] = period.split("-").map(Number);
  return y! * 12 + (m! - 1);
}

function indexToPeriod(idx: number): string {
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** Infer the month-step from the last two history periods (fallback 1 month) and
 *  project `count` periods sequentially after the last known/anchor period. */
function generateFuturePeriods(historyPeriods: string[], count: number, fallbackAnchor: string): string[] {
  let step = 1;
  let anchorIdx: number;
  if (historyPeriods.length >= 2) {
    const last = periodToIndex(historyPeriods[historyPeriods.length - 1]!);
    const prev = periodToIndex(historyPeriods[historyPeriods.length - 2]!);
    const diff = last - prev;
    step = diff > 0 ? diff : 1;
    anchorIdx = last;
  } else if (historyPeriods.length === 1) {
    anchorIdx = periodToIndex(historyPeriods[0]!);
  } else {
    anchorIdx = periodToIndex(fallbackAnchor);
  }
  return Array.from({ length: count }, (_, i) => indexToPeriod(anchorIdx + step * (i + 1)));
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const qp = GetForecastQueryParams.safeParse(Object.fromEntries(url.searchParams));
  if (!qp.success) return NextResponse.json({ error: qp.error.message }, { status: 400 });

  const rawMetric = qp.data.metric;
  const metric: Metric =
    rawMetric === "revenue" || rawMetric === "cost" || rawMetric === "profit" ? rawMetric : "profit";
  const horizon = Math.min(30, Math.max(1, qp.data.horizon ?? 7));

  const conditions = buildRecordConditions({
    dateFrom: qp.data.dateFrom,
    dateTo: qp.data.dateTo,
    clientIds: parseIdList(qp.data.clientIds),
    partnerIds: parseIdList(qp.data.partnerIds),
    buyingHouseIds: parseIdList(qp.data.buyingHouseIds),
  });
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const recs = await db.select().from(billingRecordsTable).where(whereClause);

  const byPeriod = aggregateBy(recs as AggRecord[], (r) => r.period);
  const history = Array.from(byPeriod.entries())
    .map(([period, t]) => ({ date: period, value: t[metric] }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const fc = linearForecast(history.map((h) => h.value), horizon);
  const futurePeriods = generateFuturePeriods(
    history.map((h) => h.date),
    horizon,
    monthOf(qp.data.dateTo) ?? new Date().toISOString().slice(0, 7),
  );
  const forecast = fc.map((p, i) => ({ date: futurePeriods[i]!, value: p.value, lower: p.lower, upper: p.upper }));

  return NextResponse.json(GetForecastResponse.parse({ history, forecast }));
}
