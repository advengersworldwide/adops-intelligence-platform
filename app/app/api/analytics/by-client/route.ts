import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db, billingRecordsTable, clientsTable, buyingHousesTable } from "@workspace/db";
import { GetAnalyticsByClientQueryParams, GetAnalyticsByClientResponse } from "@workspace/api-zod";
import { parseIdList } from "@/lib/analytics/parse-params";
import { buildRecordConditions } from "@/lib/analytics/record-filters";
import { aggregateBy, type AggRecord } from "@/lib/analytics/billing-records-agg";

import { requirePermission, isAuthError } from "@/lib/auth/require";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const auth = await requirePermission("analytics:view");
  if (isAuthError(auth)) return auth;
  const url = new URL(req.url);
  const qp = GetAnalyticsByClientQueryParams.safeParse(Object.fromEntries(url.searchParams));
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

  const byClient = aggregateBy(recs as AggRecord[], (r) => r.clientId);
  const clientIds = [...byClient.keys()].filter((id): id is number => id != null);

  const counts = new Map<number, number>();
  for (const r of recs as AggRecord[]) {
    if (r.clientId == null) continue;
    counts.set(r.clientId, (counts.get(r.clientId) ?? 0) + 1);
  }

  const clientRows = clientIds.length
    ? await db.select({
        id: clientsTable.id,
        name: clientsTable.name,
        buyingHouseName: buyingHousesTable.name,
      }).from(clientsTable)
        .leftJoin(buyingHousesTable, eq(clientsTable.buyingHouseId, buyingHousesTable.id))
        .where(inArray(clientsTable.id, clientIds))
    : [];
  const clientMap = new Map(clientRows.map((c) => [c.id, c]));

  const rows = clientIds
    .map((id) => {
      const t = byClient.get(id)!;
      const c = clientMap.get(id);
      return {
        clientId: id,
        clientName: c?.name ?? `Client ${id}`,
        buyingHouse: c?.buyingHouseName ?? undefined,
        revenue: t.revenue,
        cost: t.cost,
        profit: t.profit,
        marginPct: t.marginPct,
        transactionCount: counts.get(id) ?? 0,
      };
    })
    .sort((a, b) => b.profit - a.profit);

  return NextResponse.json(GetAnalyticsByClientResponse.parse(rows));
}
