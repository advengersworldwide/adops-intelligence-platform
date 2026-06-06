import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import {
  db, billingRecordsTable, buyingHousesTable, clientsTable,
  platformsTable, platformCostModelsTable,
} from "@workspace/db";
import { ListAllBillingRecordsQueryParams, ListAllBillingRecordsResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/billing-records", async (req, res): Promise<void> => {
  const query = ListAllBillingRecordsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }

  const conditions = [];
  if (query.data.platformId != null) conditions.push(eq(billingRecordsTable.platformId, query.data.platformId));
  if (query.data.buyingHouseId != null) conditions.push(eq(billingRecordsTable.buyingHouseId, query.data.buyingHouseId));
  if (query.data.clientId != null) conditions.push(eq(billingRecordsTable.clientId, query.data.clientId));
  if (query.data.period != null) conditions.push(eq(billingRecordsTable.period, query.data.period));

  const rows = await db
    .select({
      id: billingRecordsTable.id,
      platformId: billingRecordsTable.platformId,
      buyingHouseId: billingRecordsTable.buyingHouseId,
      clientId: billingRecordsTable.clientId,
      costModelId: billingRecordsTable.costModelId,
      period: billingRecordsTable.period,
      appsflyerPins: billingRecordsTable.appsflyerPins,
      fraudPins: billingRecordsTable.fraudPins,
      payoutRate: billingRecordsTable.payoutRate,
      marginPct: billingRecordsTable.marginPct,
      forexSellingRate: billingRecordsTable.forexSellingRate,
      forexBuyingRate: billingRecordsTable.forexBuyingRate,
      salesTaxPct: billingRecordsTable.salesTaxPct,
      remittanceTaxPct: billingRecordsTable.remittanceTaxPct,
      withholdingTaxPct: billingRecordsTable.withholdingTaxPct,
      bulkDiscountPct: billingRecordsTable.bulkDiscountPct,
      platformBulkDiscountPct: billingRecordsTable.platformBulkDiscountPct,
      createdBy: billingRecordsTable.createdBy,
      createdAt: billingRecordsTable.createdAt,
      platformName: platformsTable.name,
      buyingHouseName: buyingHousesTable.name,
      clientName: clientsTable.name,
      costModelName: platformCostModelsTable.name,
      costModelPayoutRate: platformCostModelsTable.payoutRate,
      costModelMarginPct: platformCostModelsTable.marginPct,
    })
    .from(billingRecordsTable)
    .leftJoin(platformsTable, eq(billingRecordsTable.platformId, platformsTable.id))
    .leftJoin(buyingHousesTable, eq(billingRecordsTable.buyingHouseId, buyingHousesTable.id))
    .leftJoin(clientsTable, eq(billingRecordsTable.clientId, clientsTable.id))
    .leftJoin(platformCostModelsTable, eq(billingRecordsTable.costModelId, platformCostModelsTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(billingRecordsTable.createdAt);

  const mapped = rows.map(r => ({
    id: r.id,
    platformId: r.platformId,
    platformName: r.platformName ?? null,
    buyingHouseId: r.buyingHouseId,
    buyingHouseName: r.buyingHouseName ?? null,
    clientId: r.clientId ?? null,
    clientName: r.clientName ?? null,
    costModelId: r.costModelId,
    costModelName: r.costModelName ?? null,
    costModelPayoutRate: r.costModelPayoutRate != null ? Number(r.costModelPayoutRate) : null,
    costModelMarginPct: r.costModelMarginPct != null ? Number(r.costModelMarginPct) : null,
    period: r.period,
    appsflyerPins: r.appsflyerPins,
    fraudPins: r.fraudPins,
    payoutRate: Number(r.payoutRate),
    marginPct: Number(r.marginPct),
    forexSellingRate: Number(r.forexSellingRate),
    forexBuyingRate: Number(r.forexBuyingRate),
    salesTaxPct: Number(r.salesTaxPct),
    remittanceTaxPct: Number(r.remittanceTaxPct),
    withholdingTaxPct: Number(r.withholdingTaxPct),
    bulkDiscountPct: Number(r.bulkDiscountPct),
    platformBulkDiscountPct: Number(r.platformBulkDiscountPct),
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
  }));

  res.json(ListAllBillingRecordsResponse.parse(mapped));
});

export default router;
