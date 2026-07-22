import { NextResponse } from "next/server";
import { and } from "drizzle-orm";
import { db, billingRecordsTable } from "@workspace/db";
import { GetAnomaliesQueryParams, GetAnomaliesResponse } from "@workspace/api-zod";
import { parseIdList } from "@/lib/analytics/parse-params";
import { buildRecordConditions } from "@/lib/analytics/record-filters";
import { aggregateBy, type AggRecord } from "@/lib/analytics/billing-records-agg";
import { detectAnomalies } from "@/lib/analytics/anomalies";

export const runtime = "nodejs";

const METRIC_KEYS = ["revenue", "cost", "profit"] as const;
type Metric = (typeof METRIC_KEYS)[number];

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const qp = GetAnomaliesQueryParams.safeParse(Object.fromEntries(url.searchParams));
  if (!qp.success) return NextResponse.json({ error: qp.error.message }, { status: 400 });

  const rawMetric = qp.data.metric;
  const metric: Metric =
    rawMetric === "revenue" || rawMetric === "cost" || rawMetric === "profit" ? rawMetric : "profit";
  const threshold = qp.data.threshold ?? 2.5;

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
  const series = Array.from(byPeriod.entries())
    .map(([period, t]) => ({ date: period, value: t[metric] }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const pts = detectAnomalies(series.map((r) => r.value), threshold);
  const result = series.map((r, i) => ({
    date: r.date,
    value: pts[i]!.value,
    z: pts[i]!.z,
    isAnomaly: pts[i]!.isAnomaly,
  }));

  return NextResponse.json(GetAnomaliesResponse.parse(result));
}
