import { NextResponse } from "next/server";
import { and, inArray } from "drizzle-orm";
import { db, billingRecordsTable, clientsTable, partnersTable } from "@workspace/db";
import { GetMarginMatrixQueryParams, GetMarginMatrixResponse } from "@workspace/api-zod";
import { parseIdList } from "@/lib/analytics/parse-params";
import { buildRecordConditions } from "@/lib/analytics/record-filters";
import { aggregateBy, type AggRecord } from "@/lib/analytics/billing-records-agg";
import { buildMatrix } from "@/lib/analytics/matrix";

import { requirePermission, isAuthError } from "@/lib/auth/require";

export const runtime = "nodejs";

const TOP_N = 10;

export async function GET(req: Request): Promise<Response> {
  const auth = await requirePermission("analytics:view");
  if (isAuthError(auth)) return auth;
  const url = new URL(req.url);
  const qp = GetMarginMatrixQueryParams.safeParse(Object.fromEntries(url.searchParams));
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

  const byPair = aggregateBy(
    (recs as AggRecord[]).filter((r) => r.clientId != null),
    (r) => `${r.clientId}:${r.platformId}`,
  );

  const clientIds = new Set<number>();
  const partnerIds = new Set<number>();
  for (const key of byPair.keys()) {
    const [clientId, platformId] = key.split(":").map(Number);
    clientIds.add(clientId);
    partnerIds.add(platformId);
  }

  const [clientRows, partnerRows] = await Promise.all([
    clientIds.size
      ? db.select({ id: clientsTable.id, name: clientsTable.name })
          .from(clientsTable)
          .where(inArray(clientsTable.id, [...clientIds]))
      : Promise.resolve([]),
    partnerIds.size
      ? db.select({ id: partnersTable.id, name: partnersTable.name })
          .from(partnersTable)
          .where(inArray(partnersTable.id, [...partnerIds]))
      : Promise.resolve([]),
  ]);
  const clientMap = new Map(clientRows.map((c) => [c.id, c.name]));
  const partnerMap = new Map(partnerRows.map((p) => [p.id, p.name]));

  const grouped = [...byPair.entries()].map(([key, t]) => {
    const [clientId, platformId] = key.split(":").map(Number);
    return {
      client: clientMap.get(clientId) ?? `Client ${clientId}`,
      partner: partnerMap.get(platformId) ?? `Partner ${platformId}`,
      spend: t.revenue,
      profit: t.profit,
    };
  });

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
