import { NextResponse } from "next/server";
import { and } from "drizzle-orm";
import { db, billingRecordsTable } from "@workspace/db";
import { GetDashboardSummaryQueryParams, GetDashboardSummaryResponse } from "@workspace/api-zod";
import { parseIdList } from "@/lib/analytics/parse-params";
import { buildRecordConditions } from "@/lib/analytics/record-filters";
import { aggregateTotals, type AggRecord } from "@/lib/analytics/billing-records-agg";
import { priorRange } from "@/lib/analytics/date-range";
import { percentDelta } from "@/lib/analytics/metrics";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const qp = GetDashboardSummaryQueryParams.safeParse(Object.fromEntries(url.searchParams));
  if (!qp.success) return NextResponse.json({ error: qp.error.message }, { status: 400 });

  const idFilters = {
    clientIds: parseIdList(qp.data.clientIds),
    partnerIds: parseIdList(qp.data.partnerIds),
    buyingHouseIds: parseIdList(qp.data.buyingHouseIds),
  };

  const cur = buildRecordConditions({
    dateFrom: qp.data.dateFrom,
    dateTo: qp.data.dateTo,
    ...idFilters,
  });
  const recs = await db.select().from(billingRecordsTable).where(cur.length ? and(...cur) : undefined);

  const t = aggregateTotals(recs as AggRecord[]);

  const clientCount = new Set(
    recs.map((r) => r.clientId).filter((x): x is number => x != null),
  ).size;
  const platformCount = new Set(recs.map((r) => r.platformId)).size;

  let revenueChange: number | null = null;
  let profitChange: number | null = null;
  let costChange: number | null = null;

  if (qp.data.dateFrom && qp.data.dateTo) {
    const prior = priorRange(qp.data.dateFrom, qp.data.dateTo);
    const priorConditions = buildRecordConditions({
      dateFrom: prior.from,
      dateTo: prior.to,
      ...idFilters,
    });
    const priorRecs = await db.select().from(billingRecordsTable)
      .where(priorConditions.length ? and(...priorConditions) : undefined);
    const priorT = aggregateTotals(priorRecs as AggRecord[]);

    revenueChange = percentDelta(t.revenue, priorT.revenue);
    profitChange = percentDelta(t.profit, priorT.profit);
    costChange = percentDelta(t.cost, priorT.cost);
  }

  return NextResponse.json(GetDashboardSummaryResponse.parse({
    totalRevenue: t.revenue, totalCost: t.cost, totalProfit: t.profit, marginPct: t.marginPct,
    clientCount, platformCount,
    campaignCount: 0, transactionCount: recs.length,
    revenueChange, profitChange, costChange,
  }));
}
