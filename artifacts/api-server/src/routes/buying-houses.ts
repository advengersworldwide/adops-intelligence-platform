import { Router, type IRouter } from "express";
import { eq, count } from "drizzle-orm";
import { db, buyingHousesTable, billingRecordsTable, clientsTable, platformsTable } from "@workspace/db";
import {
  ListBuyingHousesResponse,
  GetBuyingHouseResponse,
  CreateBuyingHouseBody,
  GetBuyingHouseParams,
  UpdateBuyingHouseParams,
  DeleteBuyingHouseParams,
  GetBuyingHouseAnalyticsParams,
  GetBuyingHouseAnalyticsResponse,
  ListBuyingHouseBillingRecordsParams,
  ListBuyingHouseBillingRecordsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function computeNetMargin(r: {
  appsflyerPins: number; fraudPins: number;
  payoutRate: string; marginPct: string; forexRate: string;
  salesTaxPct: string; remittanceTaxPct: string; withholdingTaxPct: string;
}): { receivablePkr: number; totalPayablePkr: number; netMarginPkr: number } {
  const actualPins = r.appsflyerPins - r.fraudPins;
  const payoutRate = Number(r.payoutRate);
  const marginPct = Number(r.marginPct);
  const forexRate = Number(r.forexRate);
  const salesTaxPct = Number(r.salesTaxPct);
  const remittanceTaxPct = Number(r.remittanceTaxPct);
  const withholdingTaxPct = Number(r.withholdingTaxPct);

  const netAmtUsd = actualPins * payoutRate;
  const netAmtPkr = netAmtUsd * forexRate;
  const grossAmtPkr = marginPct > 0 ? netAmtPkr / (1 - marginPct / 100) : netAmtPkr;
  const salesTax = grossAmtPkr * (salesTaxPct / 100);
  const totalAmtPkr = grossAmtPkr + salesTax;
  const receivablePkr = totalAmtPkr - (totalAmtPkr * withholdingTaxPct / 100) - salesTax;
  const netPayableUsd = netAmtUsd * (1 - marginPct / 100);
  const remittanceTax = netPayableUsd * (remittanceTaxPct / 100);
  const totalPayableUsd = netPayableUsd + remittanceTax;
  const totalPayablePkr = totalPayableUsd * forexRate;
  return { receivablePkr, totalPayablePkr, netMarginPkr: receivablePkr - totalPayablePkr };
}

router.get("/buying-houses", async (req, res): Promise<void> => {
  const bhs = await db.select().from(buyingHousesTable).orderBy(buyingHousesTable.createdAt);
  const result = await Promise.all(bhs.map(async (bh) => {
    const [{ clientCount }] = await db
      .select({ clientCount: count() })
      .from(clientsTable)
      .where(eq(clientsTable.buyingHouseId, bh.id));
    const records = await db.select().from(billingRecordsTable)
      .where(eq(billingRecordsTable.buyingHouseId, bh.id));
    const netMarginPkr = records.reduce((sum, r) => sum + computeNetMargin(r).netMarginPkr, 0);
    return { id: bh.id, name: bh.name, clientCount: Number(clientCount), netMarginPkr, createdAt: bh.createdAt.toISOString() };
  }));
  res.json(ListBuyingHousesResponse.parse(result));
});

router.post("/buying-houses", async (req, res): Promise<void> => {
  const parsed = CreateBuyingHouseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.insert(buyingHousesTable).values({ name: parsed.data.name }).returning();
  res.status(201).json(GetBuyingHouseResponse.parse({ id: row.id, name: row.name, clientCount: 0, netMarginPkr: 0, createdAt: row.createdAt.toISOString() }));
});

router.get("/buying-houses/:id", async (req, res): Promise<void> => {
  const params = GetBuyingHouseParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [bh] = await db.select().from(buyingHousesTable).where(eq(buyingHousesTable.id, params.data.id));
  if (!bh) { res.status(404).json({ error: "Buying house not found" }); return; }
  const [{ clientCount }] = await db
    .select({ clientCount: count() })
    .from(clientsTable)
    .where(eq(clientsTable.buyingHouseId, bh.id));
  const records = await db.select().from(billingRecordsTable)
    .where(eq(billingRecordsTable.buyingHouseId, bh.id));
  const netMarginPkr = records.reduce((sum, r) => sum + computeNetMargin(r).netMarginPkr, 0);
  res.json(GetBuyingHouseResponse.parse({ id: bh.id, name: bh.name, clientCount: Number(clientCount), netMarginPkr, createdAt: bh.createdAt.toISOString() }));
});

router.patch("/buying-houses/:id", async (req, res): Promise<void> => {
  const params = UpdateBuyingHouseParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = CreateBuyingHouseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.update(buyingHousesTable).set({ name: parsed.data.name })
    .where(eq(buyingHousesTable.id, params.data.id)).returning();
  if (!row) { res.status(404).json({ error: "Buying house not found" }); return; }
  const [{ clientCount }] = await db
    .select({ clientCount: count() })
    .from(clientsTable)
    .where(eq(clientsTable.buyingHouseId, row.id));
  const records = await db.select().from(billingRecordsTable)
    .where(eq(billingRecordsTable.buyingHouseId, row.id));
  const netMarginPkr = records.reduce((sum, r) => sum + computeNetMargin(r).netMarginPkr, 0);
  res.json(GetBuyingHouseResponse.parse({ id: row.id, name: row.name, clientCount: Number(clientCount), netMarginPkr, createdAt: row.createdAt.toISOString() }));
});

router.delete("/buying-houses/:id", async (req, res): Promise<void> => {
  const params = DeleteBuyingHouseParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  try {
    const [row] = await db.delete(buyingHousesTable)
      .where(eq(buyingHousesTable.id, params.data.id)).returning();
    if (!row) { res.status(404).json({ error: "Buying house not found" }); return; }
    res.sendStatus(204);
  } catch (err: unknown) {
    const e = err as { code?: string; cause?: { code?: string } };
    const pgCode = e.code ?? e.cause?.code;
    if (pgCode === "23503") {
      res.status(400).json({ error: "Cannot delete: this buying house has billing records linked to it. Reassign or delete those records first." });
      return;
    }
    console.error("[buying-houses DELETE]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to delete buying house" });
  }
});

router.get("/buying-houses/:id/analytics", async (req, res): Promise<void> => {
  const params = GetBuyingHouseAnalyticsParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [bh] = await db.select().from(buyingHousesTable).where(eq(buyingHousesTable.id, params.data.id));
  if (!bh) { res.status(404).json({ error: "Buying house not found" }); return; }

  const records = await db.select().from(billingRecordsTable)
    .where(eq(billingRecordsTable.buyingHouseId, params.data.id));

  let totalReceivablePkr = 0;
  let totalPayablePkr = 0;
  const periodMap = new Map<string, { receivablePkr: number; payablePkr: number; netMarginPkr: number }>();

  for (const r of records) {
    const { receivablePkr, totalPayablePkr: payablePkr, netMarginPkr } = computeNetMargin(r);
    totalReceivablePkr += receivablePkr;
    totalPayablePkr += payablePkr;
    const prev = periodMap.get(r.period) ?? { receivablePkr: 0, payablePkr: 0, netMarginPkr: 0 };
    periodMap.set(r.period, {
      receivablePkr: prev.receivablePkr + receivablePkr,
      payablePkr: prev.payablePkr + payablePkr,
      netMarginPkr: prev.netMarginPkr + netMarginPkr,
    });
  }

  const netMarginPkr = totalReceivablePkr - totalPayablePkr;
  const marginPct = totalReceivablePkr > 0 ? (netMarginPkr / totalReceivablePkr) * 100 : 0;
  const monthlyTrend = Array.from(periodMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, vals]) => ({ period, ...vals }));

  const clientRows = await db.select({
    id: clientsTable.id,
    name: clientsTable.name,
    pricingModel: clientsTable.pricingModel,
    marginValue: clientsTable.marginValue,
  }).from(clientsTable).where(eq(clientsTable.buyingHouseId, params.data.id));

  const clients = clientRows.map(c => ({
    id: c.id,
    name: c.name,
    pricingModel: c.pricingModel,
    marginValue: c.marginValue !== null ? parseFloat(c.marginValue) : null,
  }));

  res.json(GetBuyingHouseAnalyticsResponse.parse({ totalReceivablePkr, totalPayablePkr, netMarginPkr, marginPct, monthlyTrend, clients }));
});

router.get("/buying-houses/:id/billing-records", async (req, res): Promise<void> => {
  const params = ListBuyingHouseBillingRecordsParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [bh] = await db.select().from(buyingHousesTable).where(eq(buyingHousesTable.id, params.data.id));
  if (!bh) { res.status(404).json({ error: "Buying house not found" }); return; }

  const rows = await db
    .select({
      id: billingRecordsTable.id,
      period: billingRecordsTable.period,
      platformId: billingRecordsTable.platformId,
      appsflyerPins: billingRecordsTable.appsflyerPins,
      fraudPins: billingRecordsTable.fraudPins,
      payoutRate: billingRecordsTable.payoutRate,
      marginPct: billingRecordsTable.marginPct,
      forexRate: billingRecordsTable.forexRate,
      salesTaxPct: billingRecordsTable.salesTaxPct,
      remittanceTaxPct: billingRecordsTable.remittanceTaxPct,
      withholdingTaxPct: billingRecordsTable.withholdingTaxPct,
      createdAt: billingRecordsTable.createdAt,
      platformName: platformsTable.name,
    })
    .from(billingRecordsTable)
    .leftJoin(platformsTable, eq(billingRecordsTable.platformId, platformsTable.id))
    .where(eq(billingRecordsTable.buyingHouseId, params.data.id))
    .orderBy(billingRecordsTable.period);

  const mapped = rows.map(r => ({
    id: r.id,
    period: r.period,
    platformId: r.platformId,
    platformName: r.platformName ?? null,
    appsflyerPins: r.appsflyerPins,
    fraudPins: r.fraudPins,
    actualPins: r.appsflyerPins - r.fraudPins,
    netMarginPkr: computeNetMargin(r).netMarginPkr,
    createdAt: r.createdAt.toISOString(),
  }));

  res.json(ListBuyingHouseBillingRecordsResponse.parse(mapped));
});

export default router;
