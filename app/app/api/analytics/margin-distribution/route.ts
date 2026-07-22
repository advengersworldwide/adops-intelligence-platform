import { NextResponse } from "next/server";
import { and } from "drizzle-orm";
import { db, billingRecordsTable } from "@workspace/db";
import { GetMarginDistributionQueryParams, GetMarginDistributionResponse } from "@workspace/api-zod";
import { parseIdList } from "@/lib/analytics/parse-params";
import { buildRecordConditions } from "@/lib/analytics/record-filters";
import { bucketMargins } from "@/lib/analytics/distribution";
import { computeRow } from "@/lib/compute-row";
import type { AggRecord } from "@/lib/analytics/billing-records-agg";

import { requirePermission, isAuthError } from "@/lib/auth/require";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const auth = await requirePermission("analytics:view");
  if (isAuthError(auth)) return auth;
  const url = new URL(req.url);
  const qp = GetMarginDistributionQueryParams.safeParse(Object.fromEntries(url.searchParams));
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

  const margins = (recs as AggRecord[])
    .map((r) => {
      const c = computeRow(r);
      return c.receivablePkr > 0 ? (c.netMarginPkr / c.receivablePkr) * 100 : null;
    })
    .filter((m): m is number => m !== null);

  const buckets = bucketMargins(margins, 10);

  return NextResponse.json(GetMarginDistributionResponse.parse(buckets));
}
