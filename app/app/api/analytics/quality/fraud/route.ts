import { NextResponse } from "next/server";
import { and, gte, inArray, lte } from "drizzle-orm";
import { db, billingRecordsTable } from "@workspace/db";
import { GetFraudQualityQueryParams, GetFraudQualityResponse } from "@workspace/api-zod";
import { parseIdList } from "@/lib/analytics/parse-params";
import { buildFraudSeries } from "@/lib/analytics/fraud";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const qp = GetFraudQualityQueryParams.safeParse(Object.fromEntries(url.searchParams));
  if (!qp.success) return NextResponse.json({ error: qp.error.message }, { status: 400 });

  const clientIds = parseIdList(qp.data.clientIds);
  const partnerIds = parseIdList(qp.data.partnerIds);
  const buyingHouseIds = parseIdList(qp.data.buyingHouseIds);

  const conditions = [];
  if (clientIds.length > 0) conditions.push(inArray(billingRecordsTable.clientId, clientIds));
  if (partnerIds.length > 0) conditions.push(inArray(billingRecordsTable.platformId, partnerIds));
  if (buyingHouseIds.length > 0) conditions.push(inArray(billingRecordsTable.buyingHouseId, buyingHouseIds));
  if (qp.data.dateFrom) conditions.push(gte(billingRecordsTable.period, qp.data.dateFrom.slice(0, 7)));
  if (qp.data.dateTo) conditions.push(lte(billingRecordsTable.period, qp.data.dateTo.slice(0, 7)));

  const rows = await db
    .select({
      period: billingRecordsTable.period,
      appsflyerPins: billingRecordsTable.appsflyerPins,
      fraudPins: billingRecordsTable.fraudPins,
    })
    .from(billingRecordsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  const series = buildFraudSeries(rows);

  return NextResponse.json(GetFraudQualityResponse.parse(series));
}
