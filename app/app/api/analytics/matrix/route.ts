import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db, transactionsTable, campaignsTable, clientsTable, partnersTable } from "@workspace/db";
import { GetMarginMatrixQueryParams, GetMarginMatrixResponse } from "@workspace/api-zod";
import { parseIdList } from "@/lib/analytics/parse-params";
import { buildTransactionConditions } from "@/lib/analytics/route-filters";
import { buildMatrix } from "@/lib/analytics/matrix";

export const runtime = "nodejs";

const TOP_N = 10;

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const qp = GetMarginMatrixQueryParams.safeParse(Object.fromEntries(url.searchParams));
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
    client: clientsTable.name,
    partner: partnersTable.name,
    spend: sql<string>`coalesce(sum(${transactionsTable.spend}), 0)`,
    profit: sql<string>`coalesce(sum(${transactionsTable.profit}), 0)`,
  }).from(transactionsTable)
    .innerJoin(campaignsTable, eq(transactionsTable.campaignId, campaignsTable.id))
    .innerJoin(clientsTable, eq(campaignsTable.clientId, clientsTable.id))
    .innerJoin(partnersTable, eq(campaignsTable.platformId, partnersTable.id))
    .where(whereClause)
    .groupBy(clientsTable.name, partnersTable.name);

  const grouped = rows.map(r => ({
    client: r.client,
    partner: r.partner,
    spend: parseFloat(r.spend ?? "0"),
    profit: parseFloat(r.profit ?? "0"),
  }));

  const clientRevenue = new Map<string, number>();
  const partnerRevenue = new Map<string, number>();
  for (const row of grouped) {
    clientRevenue.set(row.client, (clientRevenue.get(row.client) ?? 0) + row.spend);
    partnerRevenue.set(row.partner, (partnerRevenue.get(row.partner) ?? 0) + row.spend);
  }

  const topClients = new Set(
    [...clientRevenue.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_N).map(([name]) => name)
  );
  const topPartners = new Set(
    [...partnerRevenue.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_N).map(([name]) => name)
  );

  const filteredRows = grouped.filter(row => topClients.has(row.client) && topPartners.has(row.partner));

  return NextResponse.json(GetMarginMatrixResponse.parse(buildMatrix(filteredRows)));
}
