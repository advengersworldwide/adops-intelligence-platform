import { NextResponse } from "next/server";
import { and } from "drizzle-orm";
import { db, billingRecordsTable } from "@workspace/db";
import { GetProfitOverTimeQueryParams, GetProfitOverTimeResponse } from "@workspace/api-zod";
import { parseIdList } from "@/lib/analytics/parse-params";
import { buildRecordConditions } from "@/lib/analytics/record-filters";
import { aggregateBy, type AggRecord } from "@/lib/analytics/billing-records-agg";

import { requirePermission, isAuthError } from "@/lib/auth/require";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const auth = await requirePermission("analytics:view");
  if (isAuthError(auth)) return auth;
  const url = new URL(req.url);
  const qp = GetProfitOverTimeQueryParams.safeParse(Object.fromEntries(url.searchParams));
  if (!qp.success) return NextResponse.json({ error: qp.error.message }, { status: 400 });

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
  const points = Array.from(byPeriod.entries())
    .map(([period, t]) => ({ date: period, revenue: t.revenue, cost: t.cost, profit: t.profit }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json(GetProfitOverTimeResponse.parse(points));
}
