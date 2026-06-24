import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, billingRecordsTable, buyingHousesTable, clientsTable, partnersTable, costModelsTable } from "@workspace/db";
import { ListAllBillingRecordsQueryParams, ListAllBillingRecordsResponse } from "@workspace/api-zod";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const qp = ListAllBillingRecordsQueryParams.safeParse(Object.fromEntries(url.searchParams));
  if (!qp.success) return NextResponse.json({ error: qp.error.message }, { status: 400 });

  const conditions = [];
  if (qp.data.platformId != null) conditions.push(eq(billingRecordsTable.platformId, qp.data.platformId));
  if (qp.data.buyingHouseId != null) conditions.push(eq(billingRecordsTable.buyingHouseId, qp.data.buyingHouseId));
  if (qp.data.clientId != null) conditions.push(eq(billingRecordsTable.clientId, qp.data.clientId));
  if (qp.data.period != null) conditions.push(eq(billingRecordsTable.period, qp.data.period));

  const rows = await db
    .select({
      id: billingRecordsTable.id, platformId: billingRecordsTable.platformId,
      buyingHouseId: billingRecordsTable.buyingHouseId, clientId: billingRecordsTable.clientId,
      costModelId: billingRecordsTable.costModelId, period: billingRecordsTable.period,
      appsflyerPins: billingRecordsTable.appsflyerPins, fraudPins: billingRecordsTable.fraudPins,
      payoutRate: billingRecordsTable.payoutRate, marginPct: billingRecordsTable.marginPct,
      forexSellingRate: billingRecordsTable.forexSellingRate, forexBuyingRate: billingRecordsTable.forexBuyingRate,
      salesTaxPct: billingRecordsTable.salesTaxPct, remittanceTaxPct: billingRecordsTable.remittanceTaxPct,
      withholdingTaxPct: billingRecordsTable.withholdingTaxPct, bulkDiscountPct: billingRecordsTable.bulkDiscountPct,
      platformBulkDiscountPct: billingRecordsTable.platformBulkDiscountPct,
      createdBy: billingRecordsTable.createdBy, createdAt: billingRecordsTable.createdAt,
      platformName: partnersTable.name, buyingHouseName: buyingHousesTable.name,
      clientName: clientsTable.name, costModelName: costModelsTable.name,
    })
    .from(billingRecordsTable)
    .leftJoin(partnersTable, eq(billingRecordsTable.platformId, partnersTable.id))
    .leftJoin(buyingHousesTable, eq(billingRecordsTable.buyingHouseId, buyingHousesTable.id))
    .leftJoin(clientsTable, eq(billingRecordsTable.clientId, clientsTable.id))
    .leftJoin(costModelsTable, eq(billingRecordsTable.costModelId, costModelsTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(billingRecordsTable.createdAt);

  const mapped = rows.map(r => ({
    id: r.id, platformId: r.platformId, platformName: r.platformName ?? null,
    buyingHouseId: r.buyingHouseId, buyingHouseName: r.buyingHouseName ?? null,
    clientId: r.clientId ?? null, clientName: r.clientName ?? null,
    costModelId: r.costModelId, costModelName: r.costModelName ?? null,
    costModelPayoutRate: null, costModelMarginPct: null,
    period: r.period, appsflyerPins: r.appsflyerPins, fraudPins: r.fraudPins,
    payoutRate: Number(r.payoutRate), marginPct: Number(r.marginPct),
    forexSellingRate: Number(r.forexSellingRate), forexBuyingRate: Number(r.forexBuyingRate),
    salesTaxPct: Number(r.salesTaxPct), remittanceTaxPct: Number(r.remittanceTaxPct),
    withholdingTaxPct: Number(r.withholdingTaxPct), bulkDiscountPct: Number(r.bulkDiscountPct),
    platformBulkDiscountPct: Number(r.platformBulkDiscountPct),
    createdBy: r.createdBy, createdAt: r.createdAt.toISOString(),
  }));

  return NextResponse.json(ListAllBillingRecordsResponse.parse(mapped));
}
