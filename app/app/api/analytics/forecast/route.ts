import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db, transactionsTable, campaignsTable, clientsTable } from "@workspace/db";
import { GetForecastQueryParams, GetForecastResponse } from "@workspace/api-zod";
import { parseIdList } from "@/lib/analytics/parse-params";
import { buildTransactionConditions } from "@/lib/analytics/route-filters";
import { linearForecast } from "@/lib/analytics/forecast";

export const runtime = "nodejs";

const DAY_MS = 24 * 60 * 60 * 1000;

const METRIC_COLUMNS = {
  revenue: transactionsTable.spend,
  cost: transactionsTable.cost,
  profit: transactionsTable.profit,
} as const;
type Metric = keyof typeof METRIC_COLUMNS;

function parseUtcDate(d: string): Date {
  return new Date(`${d}T00:00:00Z`);
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Infer the day-step from the last two history dates (fallback 1 day) and
 *  project `count` dates sequentially after the last known/anchor date. */
function generateFutureDates(historyDates: string[], count: number, fallbackAnchor: string): string[] {
  let stepMs = DAY_MS;
  let anchor: Date;
  if (historyDates.length >= 2) {
    const last = parseUtcDate(historyDates[historyDates.length - 1]);
    const prev = parseUtcDate(historyDates[historyDates.length - 2]);
    const diff = last.getTime() - prev.getTime();
    stepMs = diff > 0 ? diff : DAY_MS;
    anchor = last;
  } else if (historyDates.length === 1) {
    anchor = parseUtcDate(historyDates[0]);
  } else {
    anchor = parseUtcDate(fallbackAnchor);
  }
  return Array.from({ length: count }, (_, i) => toIsoDate(new Date(anchor.getTime() + stepMs * (i + 1))));
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const qp = GetForecastQueryParams.safeParse(Object.fromEntries(url.searchParams));
  if (!qp.success) return NextResponse.json({ error: qp.error.message }, { status: 400 });

  const rawMetric = qp.data.metric;
  const metric: Metric =
    rawMetric === "revenue" || rawMetric === "cost" || rawMetric === "profit" ? rawMetric : "profit";
  const horizon = Math.min(30, Math.max(1, qp.data.horizon ?? 7));

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

  const history = rows.map((r) => ({ date: r.date, value: parseFloat(r.value ?? "0") }));
  const fc = linearForecast(history.map((h) => h.value), horizon);
  const futureDates = generateFutureDates(
    history.map((h) => h.date),
    horizon,
    qp.data.dateTo ?? toIsoDate(new Date()),
  );
  const forecast = fc.map((p, i) => ({ date: futureDates[i], value: p.value, lower: p.lower, upper: p.upper }));

  return NextResponse.json(GetForecastResponse.parse({ history, forecast }));
}
