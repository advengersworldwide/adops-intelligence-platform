import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, platformsTable, platformCostModelsTable } from "@workspace/db";
import {
  CreatePlatformBody,
  UpdatePlatformBody,
  UpdatePlatformParams,
  GetPlatformParams,
  DeletePlatformParams,
  ListPlatformsResponse,
  GetPlatformResponse,
  UpdatePlatformResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function mapRow(r: typeof platformsTable.$inferSelect) {
  const costModels = await db
    .select()
    .from(platformCostModelsTable)
    .where(eq(platformCostModelsTable.platformId, r.id))
    .orderBy(platformCostModelsTable.createdAt);

  return {
    id: r.id,
    name: r.name,
    address: r.address,
    pocName: r.pocName,
    pocNumber: r.pocNumber,
    pocEmail: r.pocEmail,
    companyEmail: r.companyEmail,
    companyNumber: r.companyNumber,
    bankName: r.bankName,
    bankAccountNumber: r.bankAccountNumber,
    bankAddress: r.bankAddress,
    swiftCode: r.swiftCode,
    iban: r.iban,
    salesTaxNumber: r.salesTaxNumber,
    ntnNumber: r.ntnNumber,
    paymentTerms: r.paymentTerms,
    salesTaxPct: r.salesTaxPct !== null ? Number(r.salesTaxPct) : null,
    remittanceTaxPct: r.remittanceTaxPct !== null ? Number(r.remittanceTaxPct) : null,
    withholdingTaxPct: r.withholdingTaxPct !== null ? Number(r.withholdingTaxPct) : null,
    costModels: costModels.map(cm => ({
      id: cm.id,
      platformId: cm.platformId,
      name: cm.name,
      payoutRate: Number(cm.payoutRate),
      marginPct: Number(cm.marginPct),
      createdAt: cm.createdAt.toISOString(),
    })),
    createdAt: r.createdAt.toISOString(),
  };
}

router.get("/platforms", async (req, res): Promise<void> => {
  const rows = await db.select().from(platformsTable).orderBy(platformsTable.createdAt);
  const mapped = await Promise.all(rows.map(mapRow));
  res.json(ListPlatformsResponse.parse(mapped));
});

router.post("/platforms", async (req, res): Promise<void> => {
  const parsed = CreatePlatformBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.insert(platformsTable).values(parsed.data).returning();
  res.status(201).json(GetPlatformResponse.parse(await mapRow(row)));
});

router.get("/platforms/:id", async (req, res): Promise<void> => {
  const params = GetPlatformParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.select().from(platformsTable).where(eq(platformsTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Platform not found" });
    return;
  }
  res.json(GetPlatformResponse.parse(await mapRow(row)));
});

router.patch("/platforms/:id", async (req, res): Promise<void> => {
  const params = UpdatePlatformParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdatePlatformBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { salesTaxPct, remittanceTaxPct, withholdingTaxPct, ...rest } = parsed.data;
  const updates: Partial<typeof platformsTable.$inferInsert> = { ...rest };
  if (salesTaxPct !== undefined) {
    updates.salesTaxPct = salesTaxPct !== null ? String(salesTaxPct) : null;
  }
  if (remittanceTaxPct !== undefined) {
    updates.remittanceTaxPct = remittanceTaxPct !== null ? String(remittanceTaxPct) : null;
  }
  if (withholdingTaxPct !== undefined) {
    updates.withholdingTaxPct = withholdingTaxPct !== null ? String(withholdingTaxPct) : null;
  }
  const [row] = await db
    .update(platformsTable)
    .set(updates)
    .where(eq(platformsTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Platform not found" });
    return;
  }
  res.json(UpdatePlatformResponse.parse(await mapRow(row)));
});

router.delete("/platforms/:id", async (req, res): Promise<void> => {
  const params = DeletePlatformParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .delete(platformsTable)
    .where(eq(platformsTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Platform not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
