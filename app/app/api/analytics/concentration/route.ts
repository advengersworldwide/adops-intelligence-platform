import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db, transactionsTable, campaignsTable, clientsTable } from "@workspace/db";
import { GetConcentrationQueryParams, GetConcentrationResponse } from "@workspace/api-zod";
import { parseIdList } from "@/lib/analytics/parse-params";
import { buildTransactionConditions } from "@/lib/analytics/route-filters";
import { concentration } from "@/lib/analytics/concentration";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const qp = GetConcentrationQueryParams.safeParse(Object.fromEntries(url.searchParams));
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
    clientName: clientsTable.name,
    revenue: sql<string>`coalesce(sum(${transactionsTable.spend}), 0)`,
  }).from(clientsTable)
    .leftJoin(campaignsTable, eq(campaignsTable.clientId, clientsTable.id))
    .leftJoin(transactionsTable, and(eq(transactionsTable.campaignId, campaignsTable.id), whereClause))
    .groupBy(clientsTable.id, clientsTable.name);

  const items = rows
    .map((r) => ({ name: r.clientName, revenue: parseFloat(r.revenue ?? "0") }))
    .filter((r): r is { name: string; revenue: number } => !!r.name && r.revenue > 0);

  return NextResponse.json(GetConcentrationResponse.parse(concentration(items)));
}
