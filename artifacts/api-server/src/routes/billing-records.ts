import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, billingRecordsTable, buyingHousesTable, platformCostModelsTable, clientsTable } from "@workspace/db";
import { optionalAuth } from "../middlewares/auth";
import {
  ListBillingRecordsParams,
  ListBillingRecordsQueryParams,
  ListBillingRecordsResponse,
  CreateBillingRecordParams,
  CreateBillingRecordBody,
  ListBillingRecordsResponseItem,
  DeleteBillingRecordParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function mapRecord(r: typeof billingRecordsTable.$inferSelect) {
  const [bh] = await db.select().from(buyingHousesTable).where(eq(buyingHousesTable.id, r.buyingHouseId));
  const [cm] = await db.select().from(platformCostModelsTable)
    .where(eq(platformCostModelsTable.id, r.costModelId));
  const client = r.clientId
    ? (await db.select({ name: clientsTable.name }).from(clientsTable)
        .where(eq(clientsTable.id, r.clientId)))[0]
    : null;
  return {
    id: r.id,
    platformId: r.platformId,
    buyingHouseId: r.buyingHouseId,
    buyingHouseName: bh?.name ?? null,
    clientId: r.clientId ?? null,
    clientName: client?.name ?? null,
    costModelId: r.costModelId,
    costModelName: cm?.name ?? null,
    costModelPayoutRate: cm ? Number(cm.payoutRate) : null,
    costModelMarginPct: cm ? Number(cm.marginPct) : null,
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
  };
}

router.get("/platforms/:id/billing-records", async (req, res): Promise<void> => {
  const params = ListBillingRecordsParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const query = ListBillingRecordsQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }

  const conditions = [eq(billingRecordsTable.platformId, params.data.id)];
  if (query.data.period != null) conditions.push(eq(billingRecordsTable.period, query.data.period));
  if (query.data.buyingHouseId != null) conditions.push(eq(billingRecordsTable.buyingHouseId, query.data.buyingHouseId));
  if (query.data.clientId != null) conditions.push(eq(billingRecordsTable.clientId, query.data.clientId));

  const rows = await db.select().from(billingRecordsTable)
    .where(and(...conditions)).orderBy(billingRecordsTable.createdAt);
  const mapped = await Promise.all(rows.map(mapRecord));
  res.json(ListBillingRecordsResponse.parse(mapped));
});

router.post("/platforms/:id/billing-records", optionalAuth, async (req, res): Promise<void> => {
  const params = CreateBillingRecordParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = CreateBillingRecordBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  try {
    const createdBy: string | null = req.user?.name ?? req.user?.email ?? null;
    const [row] = await db.insert(billingRecordsTable).values({
      platformId: params.data.id,
      buyingHouseId: parsed.data.buyingHouseId,
      clientId: parsed.data.clientId ?? null,
      costModelId: parsed.data.costModelId,
      period: parsed.data.period,
      appsflyerPins: parsed.data.appsflyerPins,
      fraudPins: parsed.data.fraudPins,
      payoutRate: String(parsed.data.payoutRate),
      marginPct: String(parsed.data.marginPct),
      forexSellingRate: String(parsed.data.forexSellingRate),
      forexBuyingRate: String(parsed.data.forexBuyingRate),
      salesTaxPct: String(parsed.data.salesTaxPct),
      remittanceTaxPct: String(parsed.data.remittanceTaxPct),
      withholdingTaxPct: String(parsed.data.withholdingTaxPct),
      bulkDiscountPct: String(parsed.data.bulkDiscountPct),
      platformBulkDiscountPct: String(parsed.data.platformBulkDiscountPct),
      createdBy,
    }).returning();
    res.status(201).json(ListBillingRecordsResponseItem.parse(await mapRecord(row)));
  } catch (err) {
    console.error("[billing-records POST]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create billing record" });
  }
});

router.patch("/platforms/:id/billing-records/:recordId", optionalAuth, async (req, res): Promise<void> => {
  const params = DeleteBillingRecordParams.safeParse({
    id: parseInt(req.params.id as string, 10),
    recordId: parseInt(req.params.recordId as string, 10),
  });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = CreateBillingRecordBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  try {
    const [row] = await db.update(billingRecordsTable).set({
      buyingHouseId: parsed.data.buyingHouseId,
      clientId: parsed.data.clientId ?? null,
      costModelId: parsed.data.costModelId,
      period: parsed.data.period,
      appsflyerPins: parsed.data.appsflyerPins,
      fraudPins: parsed.data.fraudPins,
      payoutRate: String(parsed.data.payoutRate),
      marginPct: String(parsed.data.marginPct),
      forexSellingRate: String(parsed.data.forexSellingRate),
      forexBuyingRate: String(parsed.data.forexBuyingRate),
      salesTaxPct: String(parsed.data.salesTaxPct),
      remittanceTaxPct: String(parsed.data.remittanceTaxPct),
      withholdingTaxPct: String(parsed.data.withholdingTaxPct),
      bulkDiscountPct: String(parsed.data.bulkDiscountPct),
      platformBulkDiscountPct: String(parsed.data.platformBulkDiscountPct),
    }).where(and(
      eq(billingRecordsTable.id, params.data.recordId),
      eq(billingRecordsTable.platformId, params.data.id),
    )).returning();
    if (!row) { res.status(404).json({ error: "Billing record not found" }); return; }
    res.json(ListBillingRecordsResponseItem.parse(await mapRecord(row)));
  } catch (err) {
    console.error("[billing-records PATCH]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update" });
  }
});

router.delete("/platforms/:id/billing-records/:recordId", async (req, res): Promise<void> => {
  const params = DeleteBillingRecordParams.safeParse({
    id: parseInt(req.params.id as string, 10),
    recordId: parseInt(req.params.recordId as string, 10),
  });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db.delete(billingRecordsTable)
    .where(and(
      eq(billingRecordsTable.id, params.data.recordId),
      eq(billingRecordsTable.platformId, params.data.id),
    )).returning();
  if (!row) { res.status(404).json({ error: "Billing record not found" }); return; }
  res.sendStatus(204);
});

export default router;
