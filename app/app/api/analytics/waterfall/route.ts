import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db, billingsTable, billingLinesTable, billingEventItemsTable } from "@workspace/db";
import { GetProfitWaterfallQueryParams, GetProfitWaterfallResponse } from "@workspace/api-zod";
import { parseIdList } from "@/lib/analytics/parse-params";
import { buildWaterfall, billingLineResults } from "@/lib/analytics/waterfall";
import type { ComputeBillingResult } from "@/lib/compute-billing";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const qp = GetProfitWaterfallQueryParams.safeParse(Object.fromEntries(url.searchParams));
  if (!qp.success) return NextResponse.json({ error: qp.error.message }, { status: 400 });

  const clientIds = parseIdList(qp.data.clientIds);
  const partnerIds = parseIdList(qp.data.partnerIds);
  const period = qp.data.period;

  const billingConds = [];
  if (clientIds.length) billingConds.push(inArray(billingsTable.clientId, clientIds));
  if (period) billingConds.push(eq(billingsTable.period, period));
  const billings = await db.select().from(billingsTable)
    .where(billingConds.length ? and(...billingConds) : undefined);

  const all: ComputeBillingResult[] = [];
  for (const b of billings) {
    const lineConds = [eq(billingLinesTable.billingId, b.id)];
    if (partnerIds.length) lineConds.push(inArray(billingLinesTable.partnerId, partnerIds));
    const lineRows = await db.select().from(billingLinesTable).where(and(...lineConds));

    const lines = [];
    for (const ln of lineRows) {
      const itemRows = await db.select().from(billingEventItemsTable).where(eq(billingEventItemsTable.billingLineId, ln.id));
      lines.push({
        events: itemRows.map((it) => ({
          eventCount: it.eventCount, billableRate: Number(it.billableRate), payoutRate: Number(it.payoutRate),
        })),
      });
    }

    all.push(...billingLineResults({
      forexSellingRate: Number(b.forexSellingRate), forexBuyingRate: Number(b.forexBuyingRate),
      remittanceTaxPct: Number(b.remittanceTaxPct), salesTaxPct: Number(b.salesTaxPct),
      withholdingTaxPct: Number(b.withholdingTaxPct), bulkDiscountPct: Number(b.bulkDiscountPct),
      whtApplied: b.whtApplied,
    }, lines));
  }

  return NextResponse.json(GetProfitWaterfallResponse.parse(buildWaterfall(all)));
}
