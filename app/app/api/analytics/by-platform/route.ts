import { NextResponse } from "next/server";
import { and, inArray } from "drizzle-orm";
import { db, billingRecordsTable, partnersTable } from "@workspace/db";
import { GetAnalyticsByPartnerQueryParams, GetAnalyticsByPartnerResponse } from "@workspace/api-zod";
import { parseIdList } from "@/lib/analytics/parse-params";
import { buildRecordConditions } from "@/lib/analytics/record-filters";
import { aggregateBy, type AggRecord } from "@/lib/analytics/billing-records-agg";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const qp = GetAnalyticsByPartnerQueryParams.safeParse(Object.fromEntries(url.searchParams));
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

  const byPlatform = aggregateBy(recs as AggRecord[], (r) => r.platformId);
  const platformIds = [...byPlatform.keys()];

  const counts = new Map<number, number>();
  for (const r of recs as AggRecord[]) {
    counts.set(r.platformId, (counts.get(r.platformId) ?? 0) + 1);
  }

  const partnerRows = platformIds.length
    ? await db.select({ id: partnersTable.id, name: partnersTable.name })
        .from(partnersTable)
        .where(inArray(partnersTable.id, platformIds))
    : [];
  const partnerMap = new Map(partnerRows.map((p) => [p.id, p.name]));

  const rows = platformIds
    .map((id) => {
      const t = byPlatform.get(id)!;
      return {
        platformId: id,
        platformName: partnerMap.get(id) ?? `Platform ${id}`,
        revenue: t.revenue,
        cost: t.cost,
        profit: t.profit,
        marginPct: t.marginPct,
        transactionCount: counts.get(id) ?? 0,
      };
    })
    .sort((a, b) => b.profit - a.profit);

  return NextResponse.json(GetAnalyticsByPartnerResponse.parse(rows));
}
