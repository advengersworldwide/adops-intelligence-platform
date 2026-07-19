import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db, transactionsTable, campaignsTable, partnersTable, clientsTable } from "@workspace/db";
import { GetAnalyticsByPartnerQueryParams, GetAnalyticsByPartnerResponse } from "@workspace/api-zod";
import { parseIdList } from "@/lib/analytics/parse-params";
import { buildTransactionConditions } from "@/lib/analytics/route-filters";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const qp = GetAnalyticsByPartnerQueryParams.safeParse(Object.fromEntries(url.searchParams));
  if (!qp.success) return NextResponse.json({ error: qp.error.message }, { status: 400 });

  const conditions = buildTransactionConditions({
    dateFrom: qp.data.dateFrom,
    dateTo: qp.data.dateTo,
    clientIds: parseIdList(qp.data.clientIds),
    partnerIds: parseIdList(qp.data.partnerIds),
    buyingHouseIds: parseIdList(qp.data.buyingHouseIds),
  });
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db.select({
    platformId: partnersTable.id, platformName: partnersTable.name,
    revenue: sql<string>`coalesce(sum(${transactionsTable.spend}), 0)`,
    cost: sql<string>`coalesce(sum(${transactionsTable.cost}), 0)`,
    profit: sql<string>`coalesce(sum(${transactionsTable.profit}), 0)`,
    transactionCount: sql<number>`count(${transactionsTable.id})::int`,
  }).from(partnersTable)
    .leftJoin(campaignsTable, eq(campaignsTable.platformId, partnersTable.id))
    .leftJoin(clientsTable, eq(clientsTable.id, campaignsTable.clientId))
    .leftJoin(transactionsTable, and(eq(transactionsTable.campaignId, campaignsTable.id), whereClause))
    .groupBy(partnersTable.id, partnersTable.name)
    .orderBy(sql`sum(${transactionsTable.profit}) desc nulls last`);

  return NextResponse.json(GetAnalyticsByPartnerResponse.parse(rows.map(r => {
    const revenue = parseFloat(r.revenue ?? "0");
    const profit = parseFloat(r.profit ?? "0");
    return { platformId: r.platformId, platformName: r.platformName, revenue, cost: parseFloat(r.cost ?? "0"), profit, marginPct: revenue > 0 ? (profit / revenue) * 100 : 0, transactionCount: r.transactionCount ?? 0 };
  })));
}
