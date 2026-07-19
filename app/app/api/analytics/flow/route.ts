import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db, transactionsTable, campaignsTable, clientsTable, buyingHousesTable, partnersTable } from "@workspace/db";
import { GetMoneyFlowQueryParams, GetMoneyFlowResponse } from "@workspace/api-zod";
import { parseIdList } from "@/lib/analytics/parse-params";
import { buildTransactionConditions } from "@/lib/analytics/route-filters";
import { buildFlow, type FlowRow } from "@/lib/analytics/flow";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const qp = GetMoneyFlowQueryParams.safeParse(Object.fromEntries(url.searchParams));
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
    buyingHouseName: buyingHousesTable.name,
    partnerName: partnersTable.name,
    spend: sql<string>`coalesce(sum(${transactionsTable.spend}), 0)`,
  }).from(transactionsTable)
    .innerJoin(campaignsTable, eq(transactionsTable.campaignId, campaignsTable.id))
    .innerJoin(clientsTable, eq(campaignsTable.clientId, clientsTable.id))
    .leftJoin(buyingHousesTable, eq(clientsTable.buyingHouseId, buyingHousesTable.id))
    .innerJoin(partnersTable, eq(campaignsTable.platformId, partnersTable.id))
    .where(whereClause)
    .groupBy(clientsTable.name, buyingHousesTable.name, partnersTable.name);

  const flowRows: FlowRow[] = rows.map((r) => ({
    clientName: r.clientName,
    buyingHouseName: r.buyingHouseName,
    partnerName: r.partnerName,
    spend: parseFloat(r.spend ?? "0"),
  }));

  return NextResponse.json(GetMoneyFlowResponse.parse(buildFlow(flowRows)));
}
