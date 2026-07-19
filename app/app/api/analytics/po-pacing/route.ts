import { NextResponse } from "next/server";
import { and, inArray, isNotNull, sql } from "drizzle-orm";
import { db, partnerPurchaseOrdersTable, partnerBillsTable } from "@workspace/db";
import { GetPoPacingQueryParams, GetPoPacingResponse } from "@workspace/api-zod";
import { parseIdList } from "@/lib/analytics/parse-params";
import { pace } from "@/lib/analytics/pacing";

export const runtime = "nodejs";

// Burn-down pacing per partner purchase order: consumed (Σ partner bills against the PO) vs
// an ideal-to-date linear spend across the PO's start/end window. All amounts USD — no
// currency conversion needed (see pacing.ts for the pure calculation).
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const qp = GetPoPacingQueryParams.safeParse(Object.fromEntries(url.searchParams));
  if (!qp.success) return NextResponse.json({ error: qp.error.message }, { status: 400 });

  const partnerIds = parseIdList(qp.data.partnerIds);

  const poConds = partnerIds.length ? [inArray(partnerPurchaseOrdersTable.partnerId, partnerIds)] : [];
  const pos = await db.select().from(partnerPurchaseOrdersTable)
    .where(poConds.length ? and(...poConds) : undefined);

  // One grouped query for consumed amounts across all matching POs.
  const consumedRows = pos.length
    ? await db.select({
        partnerPurchaseOrderId: partnerBillsTable.partnerPurchaseOrderId,
        consumed: sql<string>`sum(${partnerBillsTable.amount})`,
      }).from(partnerBillsTable)
        .where(and(
          isNotNull(partnerBillsTable.partnerPurchaseOrderId),
          inArray(partnerBillsTable.partnerPurchaseOrderId, pos.map((po) => po.id)),
        ))
        .groupBy(partnerBillsTable.partnerPurchaseOrderId)
    : [];

  const consumedByPoId = new Map<number, number>();
  for (const row of consumedRows) {
    if (row.partnerPurchaseOrderId == null) continue;
    consumedByPoId.set(row.partnerPurchaseOrderId, parseFloat(row.consumed ?? "0"));
  }

  const asOf = new Date();
  const results = pos.map((po) => {
    const consumed = consumedByPoId.get(po.id) ?? 0;
    const budget = Number(po.totalBudget);
    const p = pace(consumed, budget, po.startDate, po.endDate, asOf);
    return {
      poId: po.id,
      code: po.code,
      partnerId: po.partnerId,
      startDate: po.startDate,
      endDate: po.endDate,
      budget,
      consumed,
      idealToDate: p.idealToDate,
      overpacePct: p.overpacePct,
      pctConsumed: p.pctConsumed,
      projectedExhaustion: p.projectedExhaustion,
    };
  });

  return NextResponse.json(GetPoPacingResponse.parse(results));
}
