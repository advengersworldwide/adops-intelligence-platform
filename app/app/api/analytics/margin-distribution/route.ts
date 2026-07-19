import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db, transactionsTable, campaignsTable, clientsTable } from "@workspace/db";
import { GetMarginDistributionQueryParams, GetMarginDistributionResponse } from "@workspace/api-zod";
import { parseIdList } from "@/lib/analytics/parse-params";
import { buildTransactionConditions } from "@/lib/analytics/route-filters";
import { bucketMargins } from "@/lib/analytics/distribution";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const qp = GetMarginDistributionQueryParams.safeParse(Object.fromEntries(url.searchParams));
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
    campaignId: campaignsTable.id,
    spend: sql<string>`coalesce(sum(${transactionsTable.spend}), 0)`,
    profit: sql<string>`coalesce(sum(${transactionsTable.profit}), 0)`,
  }).from(clientsTable)
    .leftJoin(campaignsTable, eq(campaignsTable.clientId, clientsTable.id))
    .leftJoin(transactionsTable, and(eq(transactionsTable.campaignId, campaignsTable.id), whereClause))
    .groupBy(campaignsTable.id);

  const margins = rows
    .filter(r => r.campaignId !== null)
    .map(r => {
      const spend = parseFloat(r.spend ?? "0");
      const profit = parseFloat(r.profit ?? "0");
      return spend > 0 ? (profit / spend) * 100 : 0;
    });

  const buckets = bucketMargins(margins, 10);

  return NextResponse.json(GetMarginDistributionResponse.parse(buckets));
}
