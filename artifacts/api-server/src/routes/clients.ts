import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, clientsTable, buyingHousesTable, paymentTermsTable } from "@workspace/db";
import {
  CreateClientBody,
  UpdateClientBody,
  UpdateClientParams,
  GetClientParams,
  DeleteClientParams,
  ListClientsResponse,
  GetClientResponse,
  UpdateClientResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function mapRow(r: typeof clientsTable.$inferSelect) {
  let buyingHouseName: string | null = null;
  if (r.buyingHouseId != null) {
    const [bh] = await db.select({ name: buyingHousesTable.name }).from(buyingHousesTable).where(eq(buyingHousesTable.id, r.buyingHouseId));
    buyingHouseName = bh?.name ?? null;
  }
  let paymentTermName: string | null = null;
  if (r.paymentTermsId != null) {
    const [pt] = await db.select({ name: paymentTermsTable.name }).from(paymentTermsTable).where(eq(paymentTermsTable.id, r.paymentTermsId));
    paymentTermName = pt?.name ?? null;
  }
  return {
    id: r.id,
    name: r.name,
    buyingHouseId: r.buyingHouseId ?? null,
    buyingHouseName,
    address: r.address, pocName: r.pocName, pocNumber: r.pocNumber, pocEmail: r.pocEmail,
    companyEmail: r.companyEmail, companyNumber: r.companyNumber,
    bankName: r.bankName, bankAccountNumber: r.bankAccountNumber, bankAddress: r.bankAddress,
    swiftCode: r.swiftCode, iban: r.iban,
    salesTaxNumber: r.salesTaxNumber, ntnNumber: r.ntnNumber,
    salesTaxPct: r.salesTaxPct != null ? Number(r.salesTaxPct) : null,
    withholdingTaxPct: r.withholdingTaxPct != null ? Number(r.withholdingTaxPct) : null,
    paymentTermsId: r.paymentTermsId ?? null,
    paymentTermName,
    createdAt: r.createdAt.toISOString(),
  };
}

router.get("/clients", async (_req, res): Promise<void> => {
  const rows = await db.select().from(clientsTable).orderBy(clientsTable.createdAt);
  const mapped = await Promise.all(rows.map(mapRow));
  res.json(ListClientsResponse.parse(mapped));
});

router.post("/clients", async (req, res): Promise<void> => {
  const parsed = CreateClientBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.insert(clientsTable).values({
    name: parsed.data.name,
    buyingHouseId: parsed.data.buyingHouseId ?? null,
  }).returning();
  res.status(201).json(GetClientResponse.parse(await mapRow(row)));
});

router.get("/clients/:id", async (req, res): Promise<void> => {
  const params = GetClientParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db.select().from(clientsTable).where(eq(clientsTable.id, params.data.id));
  if (!row) { res.status(404).json({ error: "Client not found" }); return; }
  res.json(GetClientResponse.parse(await mapRow(row)));
});

router.patch("/clients/:id", async (req, res): Promise<void> => {
  const params = UpdateClientParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateClientBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const d = parsed.data;
  const updates: Record<string, unknown> = {};
  const textKeys = ["name","buyingHouseId","address","pocName","pocNumber","pocEmail","companyEmail","companyNumber","bankName","bankAccountNumber","bankAddress","swiftCode","iban","salesTaxNumber","ntnNumber","paymentTermsId"] as const;
  for (const k of textKeys) if ((d as Record<string, unknown>)[k] !== undefined) updates[k] = (d as Record<string, unknown>)[k];
  if (d.salesTaxPct !== undefined) updates.salesTaxPct = d.salesTaxPct != null ? String(d.salesTaxPct) : null;
  if (d.withholdingTaxPct !== undefined) updates.withholdingTaxPct = d.withholdingTaxPct != null ? String(d.withholdingTaxPct) : null;
  const [row] = await db.update(clientsTable).set(updates).where(eq(clientsTable.id, params.data.id)).returning();
  if (!row) { res.status(404).json({ error: "Client not found" }); return; }
  res.json(UpdateClientResponse.parse(await mapRow(row)));
});

router.delete("/clients/:id", async (req, res): Promise<void> => {
  const params = DeleteClientParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db.delete(clientsTable).where(eq(clientsTable.id, params.data.id)).returning();
  if (!row) { res.status(404).json({ error: "Client not found" }); return; }
  res.sendStatus(204);
});

export default router;
