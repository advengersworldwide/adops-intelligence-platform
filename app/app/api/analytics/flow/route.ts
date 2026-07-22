import { NextResponse } from "next/server";
import { and, inArray } from "drizzle-orm";
import { db, billingRecordsTable, clientsTable, buyingHousesTable, partnersTable } from "@workspace/db";
import { GetMoneyFlowQueryParams, GetMoneyFlowResponse } from "@workspace/api-zod";
import { parseIdList } from "@/lib/analytics/parse-params";
import { buildRecordConditions } from "@/lib/analytics/record-filters";
import { aggregateBy, type AggRecord } from "@/lib/analytics/billing-records-agg";
import { buildFlow, type FlowRow } from "@/lib/analytics/flow";

import { requirePermission, isAuthError } from "@/lib/auth/require";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const auth = await requirePermission("analytics:view");
  if (isAuthError(auth)) return auth;
  const url = new URL(req.url);
  const qp = GetMoneyFlowQueryParams.safeParse(Object.fromEntries(url.searchParams));
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

  const byTriplet = aggregateBy(
    (recs as AggRecord[]).filter((r) => r.clientId != null),
    (r) => `${r.clientId}:${r.buyingHouseId}:${r.platformId}`,
  );

  const clientIds = new Set<number>();
  const buyingHouseIds = new Set<number>();
  const partnerIds = new Set<number>();
  for (const key of byTriplet.keys()) {
    const [clientId, buyingHouseId, platformId] = key.split(":").map(Number);
    clientIds.add(clientId);
    buyingHouseIds.add(buyingHouseId);
    partnerIds.add(platformId);
  }

  const [clientRows, buyingHouseRows, partnerRows] = await Promise.all([
    clientIds.size
      ? db.select({ id: clientsTable.id, name: clientsTable.name })
          .from(clientsTable)
          .where(inArray(clientsTable.id, [...clientIds]))
      : Promise.resolve([]),
    buyingHouseIds.size
      ? db.select({ id: buyingHousesTable.id, name: buyingHousesTable.name })
          .from(buyingHousesTable)
          .where(inArray(buyingHousesTable.id, [...buyingHouseIds]))
      : Promise.resolve([]),
    partnerIds.size
      ? db.select({ id: partnersTable.id, name: partnersTable.name })
          .from(partnersTable)
          .where(inArray(partnersTable.id, [...partnerIds]))
      : Promise.resolve([]),
  ]);
  const clientMap = new Map(clientRows.map((c) => [c.id, c.name]));
  const buyingHouseMap = new Map(buyingHouseRows.map((b) => [b.id, b.name]));
  const partnerMap = new Map(partnerRows.map((p) => [p.id, p.name]));

  const flowRows: FlowRow[] = [...byTriplet.entries()].map(([key, t]) => {
    const [clientId, buyingHouseId, platformId] = key.split(":").map(Number);
    return {
      clientName: clientMap.get(clientId) ?? `Client ${clientId}`,
      buyingHouseName: buyingHouseMap.get(buyingHouseId) ?? `Buying House ${buyingHouseId}`,
      partnerName: partnerMap.get(platformId) ?? `Partner ${platformId}`,
      spend: t.revenue,
    };
  });

  return NextResponse.json(GetMoneyFlowResponse.parse(buildFlow(flowRows)));
}
