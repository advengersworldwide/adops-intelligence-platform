import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, clientsTable, buyingHousesTable } from "@workspace/db";
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
  if (r.buyingHouseId !== null && r.buyingHouseId !== undefined) {
    const [bh] = await db.select({ name: buyingHousesTable.name })
      .from(buyingHousesTable)
      .where(eq(buyingHousesTable.id, r.buyingHouseId));
    buyingHouseName = bh?.name ?? null;
  }
  return {
    id: r.id,
    name: r.name,
    buyingHouseId: r.buyingHouseId ?? null,
    buyingHouseName,
    pricingModel: r.pricingModel,
    marginValue: r.marginValue !== null ? parseFloat(r.marginValue) : null,
    createdAt: r.createdAt.toISOString(),
  };
}

router.get("/clients", async (req, res): Promise<void> => {
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
    pricingModel: parsed.data.pricingModel as "fixed" | "percentage",
    marginValue: parsed.data.marginValue !== null && parsed.data.marginValue !== undefined
      ? String(parsed.data.marginValue) : null,
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
  const updates: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.buyingHouseId !== undefined) updates.buyingHouseId = parsed.data.buyingHouseId;
  if (parsed.data.pricingModel !== undefined) updates.pricingModel = parsed.data.pricingModel;
  if (parsed.data.marginValue !== undefined) updates.marginValue = parsed.data.marginValue !== null ? String(parsed.data.marginValue) : null;
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
