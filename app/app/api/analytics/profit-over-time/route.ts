import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db, transactionsTable, campaignsTable, clientsTable } from "@workspace/db";
import { GetProfitOverTimeQueryParams, GetProfitOverTimeResponse } from "@workspace/api-zod";
import { parseIdList } from "@/lib/analytics/parse-params";
import { buildTransactionConditions } from "@/lib/analytics/route-filters";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const qp = GetProfitOverTimeQueryParams.safeParse(Object.fromEntries(url.searchParams));
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
    date: transactionsTable.date,
    revenue: sql<string>`sum(${transactionsTable.spend})`,
    cost: sql<string>`sum(${transactionsTable.cost})`,
    profit: sql<string>`sum(${transactionsTable.profit})`,
  }).from(transactionsTable)
    .leftJoin(campaignsTable, eq(campaignsTable.id, transactionsTable.campaignId))
    .leftJoin(clientsTable, eq(clientsTable.id, campaignsTable.clientId))
    .where(whereClause).groupBy(transactionsTable.date).orderBy(transactionsTable.date);

  return NextResponse.json(GetProfitOverTimeResponse.parse(rows.map(r => ({
    date: r.date, revenue: parseFloat(r.revenue ?? "0"), cost: parseFloat(r.cost ?? "0"), profit: parseFloat(r.profit ?? "0"),
  }))));
}
