import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db, transactionsTable, campaignsTable, clientsTable, partnersTable } from "@workspace/db";
import { GetDashboardSummaryQueryParams, GetDashboardSummaryResponse } from "@workspace/api-zod";
import { parseIdList } from "@/lib/analytics/parse-params";
import { buildTransactionConditions } from "@/lib/analytics/route-filters";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const qp = GetDashboardSummaryQueryParams.safeParse(Object.fromEntries(url.searchParams));
  if (!qp.success) return NextResponse.json({ error: qp.error.message }, { status: 400 });

  const conditions = buildTransactionConditions({
    dateFrom: qp.data.dateFrom,
    dateTo: qp.data.dateTo,
    clientIds: parseIdList(qp.data.clientIds),
    partnerIds: parseIdList(qp.data.partnerIds),
    buyingHouseIds: parseIdList(qp.data.buyingHouseIds),
  });
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [agg] = await db.select({
    totalRevenue: sql<string>`coalesce(sum(${transactionsTable.spend}), 0)`,
    totalCost: sql<string>`coalesce(sum(${transactionsTable.cost}), 0)`,
    totalProfit: sql<string>`coalesce(sum(${transactionsTable.profit}), 0)`,
    transactionCount: sql<number>`count(*)::int`,
  }).from(transactionsTable)
    .leftJoin(campaignsTable, eq(campaignsTable.id, transactionsTable.campaignId))
    .leftJoin(clientsTable, eq(clientsTable.id, campaignsTable.clientId))
    .where(whereClause);

  const [counts] = await db.select({
    clientCount: sql<number>`count(distinct ${clientsTable.id})::int`,
    platformCount: sql<number>`count(distinct ${partnersTable.id})::int`,
    campaignCount: sql<number>`count(distinct ${campaignsTable.id})::int`,
  }).from(clientsTable)
    .leftJoin(campaignsTable, eq(campaignsTable.clientId, clientsTable.id))
    .leftJoin(partnersTable, eq(partnersTable.id, campaignsTable.platformId));

  const totalRevenue = parseFloat(agg?.totalRevenue ?? "0");
  const totalCost = parseFloat(agg?.totalCost ?? "0");
  const totalProfit = parseFloat(agg?.totalProfit ?? "0");
  const marginPct = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

  return NextResponse.json(GetDashboardSummaryResponse.parse({
    totalRevenue, totalCost, totalProfit, marginPct,
    clientCount: counts?.clientCount ?? 0, platformCount: counts?.platformCount ?? 0,
    campaignCount: counts?.campaignCount ?? 0, transactionCount: agg?.transactionCount ?? 0,
    revenueChange: null, profitChange: null, costChange: null,
  }));
}
