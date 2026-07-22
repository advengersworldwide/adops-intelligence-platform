import { NextResponse } from "next/server";
import { and, inArray } from "drizzle-orm";
import { db, billingRecordsTable, clientsTable } from "@workspace/db";
import { GetConcentrationQueryParams, GetConcentrationResponse } from "@workspace/api-zod";
import { parseIdList } from "@/lib/analytics/parse-params";
import { buildRecordConditions } from "@/lib/analytics/record-filters";
import { aggregateBy, type AggRecord } from "@/lib/analytics/billing-records-agg";
import { concentration } from "@/lib/analytics/concentration";

import { requirePermission, isAuthError } from "@/lib/auth/require";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const auth = await requirePermission("analytics:view");
  if (isAuthError(auth)) return auth;
  const url = new URL(req.url);
  const qp = GetConcentrationQueryParams.safeParse(Object.fromEntries(url.searchParams));
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

  const clientRows = clientIds.length
    ? await db.select({ id: clientsTable.id, name: clientsTable.name })
        .from(clientsTable)
        .where(inArray(clientsTable.id, clientIds))
    : [];
  const clientMap = new Map(clientRows.map((c) => [c.id, c.name]));

  const items = clientIds
    .map((id) => ({ name: clientMap.get(id) ?? `Client ${id}`, revenue: byClient.get(id)!.revenue }))
    .filter((r) => r.revenue > 0);

  return NextResponse.json(GetConcentrationResponse.parse(concentration(items)));
}
