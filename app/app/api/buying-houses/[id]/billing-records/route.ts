import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, buyingHousesTable, billingRecordsTable, partnersTable } from "@workspace/db";
import { computeRow } from "@/lib/compute-row";
import { ListBuyingHouseBillingRecordsParams, ListBuyingHouseBillingRecordsResponse } from "@workspace/api-zod";
import { requirePermission, isAuthError } from "@/lib/auth/require";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requirePermission("billings:view");
  if (isAuthError(auth)) return auth;
  const { id } = await params;
  const p = ListBuyingHouseBillingRecordsParams.safeParse({ id: parseInt(id, 10) });
  if (!p.success) return NextResponse.json({ error: p.error.message }, { status: 400 });
  const [bh] = await db.select().from(buyingHousesTable).where(eq(buyingHousesTable.id, p.data.id));
  if (!bh) return NextResponse.json({ error: "Buying house not found" }, { status: 404 });

  const rows = await db
    .select({
      id: billingRecordsTable.id, period: billingRecordsTable.period, platformId: billingRecordsTable.platformId,
      pins: billingRecordsTable.pins, fraudPins: billingRecordsTable.fraudPins,
      payoutRate: billingRecordsTable.payoutRate, marginPct: billingRecordsTable.marginPct,
      forexSellingRate: billingRecordsTable.forexSellingRate, forexBuyingRate: billingRecordsTable.forexBuyingRate,
      salesTaxPct: billingRecordsTable.salesTaxPct, remittanceTaxPct: billingRecordsTable.remittanceTaxPct,
      withholdingTaxPct: billingRecordsTable.withholdingTaxPct, bulkDiscountPct: billingRecordsTable.bulkDiscountPct,
      platformBulkDiscountPct: billingRecordsTable.platformBulkDiscountPct,
      createdAt: billingRecordsTable.createdAt, platformName: partnersTable.name,
    })
    .from(billingRecordsTable)
    .leftJoin(partnersTable, eq(billingRecordsTable.platformId, partnersTable.id))
    .where(eq(billingRecordsTable.buyingHouseId, p.data.id))
    .orderBy(billingRecordsTable.period);

  const mapped = rows.map(r => {
    const c = computeRow(r);
    return { id: r.id, period: r.period, platformId: r.platformId, platformName: r.platformName ?? null, pins: r.pins, fraudPins: r.fraudPins, actualPins: c.actualPins, netMarginPkr: c.netMarginPkr, createdAt: r.createdAt.toISOString() };
  });
  return NextResponse.json(ListBuyingHouseBillingRecordsResponse.parse(mapped));
}
