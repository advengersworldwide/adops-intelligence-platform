import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db, transactionsTable, campaignsTable, clientsTable } from "@workspace/db";
import { GetAnomaliesQueryParams, GetAnomaliesResponse } from "@workspace/api-zod";
import { parseIdList } from "@/lib/analytics/parse-params";
import { buildTransactionConditions } from "@/lib/analytics/route-filters";
import { detectAnomalies } from "@/lib/analytics/anomalies";

export const runtime = "nodejs";

const METRIC_COLUMNS = {
  revenue: transactionsTable.spend,
  cost: transactionsTable.cost,
  profit: transactionsTable.profit,
} as const;
type Metric = keyof typeof METRIC_COLUMNS;

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const qp = GetAnomaliesQueryParams.safeParse(Object.fromEntries(url.searchParams));
  if (!qp.success) return NextResponse.json({ error: qp.error.message }, { status: 400 });

  const rawMetric = qp.data.metric;
  const metric: Metric =
    rawMetric === "revenue" || rawMetric === "cost" || rawMetric === "profit" ? rawMetric : "profit";
  const threshold = qp.data.threshold ?? 2.5;

  const conditions = buildTransactionConditions({
    dateFrom: qp.data.dateFrom,
    dateTo: qp.data.dateTo,
    clientIds: parseIdList(qp.data.clientIds),
    partnerIds: parseIdList(qp.data.partnerIds),
    buyingHouseIds: parseIdList(qp.data.buyingHouseIds),
  });
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db.select({
    date: transactionsTable.date,
    value: sql<string>`sum(${METRIC_COLUMNS[metric]})`,
  }).from(transactionsTable)
    .leftJoin(campaignsTable, eq(campaignsTable.id, transactionsTable.campaignId))
    .leftJoin(clientsTable, eq(clientsTable.id, campaignsTable.clientId))
    .where(whereClause).groupBy(transactionsTable.date).orderBy(transactionsTable.date);

  const series = rows.map((r) => ({ date: r.date, value: parseFloat(r.value ?? "0") }));
  const pts = detectAnomalies(series.map((r) => r.value), threshold);
  const result = series.map((r, i) => ({
    date: r.date,
    value: pts[i].value,
    z: pts[i].z,
    isAnomaly: pts[i].isAnomaly,
  }));

  return NextResponse.json(GetAnomaliesResponse.parse(result));
}
