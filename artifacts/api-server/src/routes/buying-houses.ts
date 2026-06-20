import { Router, type IRouter } from "express";
import { eq, count } from "drizzle-orm";
import { db, buyingHousesTable, billingRecordsTable, clientsTable, partnersTable } from "@workspace/db";
import { computeRow } from "../lib/computeRow";
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

async function aggregateBH(bhId: number) {
  const records = await db.select().from(billingRecordsTable)
    .where(eq(billingRecordsTable.buyingHouseId, bhId));
  let totalReceivablePkr = 0;
  let totalPayablePkr = 0;
  for (const r of records) {
    const c = computeRow(r);
    totalReceivablePkr += c.receivablePkr;
    totalPayablePkr += c.totalPayablePkr;
  }
  return { totalReceivablePkr, totalPayablePkr, netMarginPkr: totalReceivablePkr - totalPayablePkr };
}

function mapBH(bh: typeof buyingHousesTable.$inferSelect) {
  return {
    id: bh.id,
    name: bh.name,
    bulkDiscountPct: bh.bulkDiscountPct !== null ? Number(bh.bulkDiscountPct) : null,
    address: bh.address, pocName: bh.pocName, pocNumber: bh.pocNumber, pocEmail: bh.pocEmail,
    companyEmail: bh.companyEmail, companyNumber: bh.companyNumber,
    bankName: bh.bankName, bankAccountNumber: bh.bankAccountNumber, bankAddress: bh.bankAddress,
    swiftCode: bh.swiftCode, iban: bh.iban,
    salesTaxNumber: bh.salesTaxNumber, ntnNumber: bh.ntnNumber,
    createdAt: bh.createdAt.toISOString(),
  };
}

router.get("/buying-houses", async (_req, res): Promise<void> => {
  const bhs = await db.select().from(buyingHousesTable).orderBy(buyingHousesTable.createdAt);
  const result = await Promise.all(bhs.map(async (bh) => {
    const [{ clientCount }] = await db
      .select({ clientCount: count() })
      .from(clientsTable)
      .where(eq(clientsTable.buyingHouseId, bh.id));
    const { netMarginPkr } = await aggregateBH(bh.id);
    return { ...mapBH(bh), clientCount: Number(clientCount), netMarginPkr };
  }));
  res.json(ListBuyingHousesResponse.parse(result));
});

router.post("/buying-houses", async (req, res): Promise<void> => {
  const parsed = CreateBuyingHouseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.insert(buyingHousesTable).values({
    name: parsed.data.name,
    bulkDiscountPct: parsed.data.bulkDiscountPct != null ? String(parsed.data.bulkDiscountPct) : null,
    address: parsed.data.address ?? null, pocName: parsed.data.pocName ?? null,
    pocNumber: parsed.data.pocNumber ?? null, pocEmail: parsed.data.pocEmail ?? null,
    companyEmail: parsed.data.companyEmail ?? null, companyNumber: parsed.data.companyNumber ?? null,
    bankName: parsed.data.bankName ?? null, bankAccountNumber: parsed.data.bankAccountNumber ?? null,
    bankAddress: parsed.data.bankAddress ?? null, swiftCode: parsed.data.swiftCode ?? null,
    iban: parsed.data.iban ?? null, salesTaxNumber: parsed.data.salesTaxNumber ?? null,
    ntnNumber: parsed.data.ntnNumber ?? null,
  }).returning();
  res.status(201).json(GetBuyingHouseResponse.parse({ ...mapBH(row), clientCount: 0, netMarginPkr: 0 }));
});

router.get("/buying-houses/:id", async (req, res): Promise<void> => {
  const params = GetBuyingHouseParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [bh] = await db.select().from(buyingHousesTable).where(eq(buyingHousesTable.id, params.data.id));
  if (!bh) { res.status(404).json({ error: "Buying house not found" }); return; }
  const [{ clientCount }] = await db.select({ clientCount: count() }).from(clientsTable)
    .where(eq(clientsTable.buyingHouseId, bh.id));
  const { netMarginPkr } = await aggregateBH(bh.id);
  res.json(GetBuyingHouseResponse.parse({ ...mapBH(bh), clientCount: Number(clientCount), netMarginPkr }));
});

router.patch("/buying-houses/:id", async (req, res): Promise<void> => {
  const params = UpdateBuyingHouseParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = CreateBuyingHouseBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const d = parsed.data;
  const updates: Record<string, unknown> = { name: d.name };
  if (d.bulkDiscountPct !== undefined) updates.bulkDiscountPct = d.bulkDiscountPct != null ? String(d.bulkDiscountPct) : null;
  const kycKeys = ["address","pocName","pocNumber","pocEmail","companyEmail","companyNumber","bankName","bankAccountNumber","bankAddress","swiftCode","iban","salesTaxNumber","ntnNumber"] as const;
  for (const k of kycKeys) if ((d as Record<string, unknown>)[k] !== undefined) updates[k] = (d as Record<string, unknown>)[k];
  const [row] = await db.update(buyingHousesTable).set(updates)
    .where(eq(buyingHousesTable.id, params.data.id)).returning();
  if (!row) { res.status(404).json({ error: "Buying house not found" }); return; }
  const [{ clientCount }] = await db.select({ clientCount: count() }).from(clientsTable)
    .where(eq(clientsTable.buyingHouseId, row.id));
  const { netMarginPkr } = await aggregateBH(row.id);
  res.json(GetBuyingHouseResponse.parse({ ...mapBH(row), clientCount: Number(clientCount), netMarginPkr }));
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
    if ((e.code ?? e.cause?.code) === "23503") {
      res.status(400).json({ error: "Cannot delete: this buying house has billing records linked to it." });
      return;
    }
    console.error("[buying-houses DELETE]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to delete" });
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
    const c = computeRow(r);
    totalReceivablePkr += c.receivablePkr;
    totalPayablePkr += c.totalPayablePkr;
    const prev = periodMap.get(r.period) ?? { receivablePkr: 0, payablePkr: 0, netMarginPkr: 0 };
    periodMap.set(r.period, {
      receivablePkr: prev.receivablePkr + c.receivablePkr,
      payablePkr: prev.payablePkr + c.totalPayablePkr,
      netMarginPkr: prev.netMarginPkr + c.netMarginPkr,
    });
  }

  const netMarginPkr = totalReceivablePkr - totalPayablePkr;
  const marginPct = totalReceivablePkr > 0 ? (netMarginPkr / totalReceivablePkr) * 100 : 0;
  const monthlyTrend = Array.from(periodMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, vals]) => ({ period, ...vals }));

  const clientRows = await db.select({ id: clientsTable.id, name: clientsTable.name })
    .from(clientsTable).where(eq(clientsTable.buyingHouseId, params.data.id));

  res.json(GetBuyingHouseAnalyticsResponse.parse({
    totalReceivablePkr, totalPayablePkr, netMarginPkr, marginPct, monthlyTrend,
    clients: clientRows,
  }));
});

router.get("/buying-houses/:id/billing-records", async (req, res): Promise<void> => {
  const params = ListBuyingHouseBillingRecordsParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [bh] = await db.select().from(buyingHousesTable).where(eq(buyingHousesTable.id, params.data.id));
  if (!bh) { res.status(404).json({ error: "Buying house not found" }); return; }

  const rows = await db
    .select({
      id: billingRecordsTable.id, period: billingRecordsTable.period,
      platformId: billingRecordsTable.platformId,
      appsflyerPins: billingRecordsTable.appsflyerPins, fraudPins: billingRecordsTable.fraudPins,
      payoutRate: billingRecordsTable.payoutRate, marginPct: billingRecordsTable.marginPct,
      forexSellingRate: billingRecordsTable.forexSellingRate, forexBuyingRate: billingRecordsTable.forexBuyingRate,
      salesTaxPct: billingRecordsTable.salesTaxPct, remittanceTaxPct: billingRecordsTable.remittanceTaxPct,
      withholdingTaxPct: billingRecordsTable.withholdingTaxPct,
      bulkDiscountPct: billingRecordsTable.bulkDiscountPct,
      platformBulkDiscountPct: billingRecordsTable.platformBulkDiscountPct,
      createdAt: billingRecordsTable.createdAt, platformName: partnersTable.name,
    })
    .from(billingRecordsTable)
    .leftJoin(partnersTable, eq(billingRecordsTable.platformId, partnersTable.id))
    .where(eq(billingRecordsTable.buyingHouseId, params.data.id))
    .orderBy(billingRecordsTable.period);

  const mapped = rows.map(r => {
    const c = computeRow(r);
    return {
      id: r.id, period: r.period, platformId: r.platformId,
      platformName: r.platformName ?? null,
      appsflyerPins: r.appsflyerPins, fraudPins: r.fraudPins,
      actualPins: c.actualPins, netMarginPkr: c.netMarginPkr,
      createdAt: r.createdAt.toISOString(),
    };
  });
  res.json(ListBuyingHouseBillingRecordsResponse.parse(mapped));
});

export default router;
