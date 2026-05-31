import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, campaignsTable, clientsTable, platformsTable } from "@workspace/db";
import {
  CreateCampaignBody,
  UpdateCampaignBody,
  UpdateCampaignParams,
  GetCampaignParams,
  DeleteCampaignParams,
  ListCampaignsQueryParams,
  ListCampaignsResponse,
  GetCampaignResponse,
  UpdateCampaignResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function enrichCampaign(row: typeof campaignsTable.$inferSelect) {
  const [client] = await db.select({ name: clientsTable.name }).from(clientsTable).where(eq(clientsTable.id, row.clientId));
  const [platform] = await db.select({ name: platformsTable.name }).from(platformsTable).where(eq(platformsTable.id, row.platformId));
  return {
    id: row.id,
    name: row.name,
    clientId: row.clientId,
    platformId: row.platformId,
    clientName: client?.name ?? null,
    platformName: platform?.name ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get("/campaigns", async (req, res): Promise<void> => {
  const qp = ListCampaignsQueryParams.safeParse(req.query);
  if (!qp.success) {
    res.status(400).json({ error: qp.error.message });
    return;
  }

  const conditions = [];
  if (qp.data.clientId !== null && qp.data.clientId !== undefined) {
    conditions.push(eq(campaignsTable.clientId, qp.data.clientId));
  }
  if (qp.data.platformId !== null && qp.data.platformId !== undefined) {
    conditions.push(eq(campaignsTable.platformId, qp.data.platformId));
  }

  const rows = await db
    .select({
      id: campaignsTable.id,
      name: campaignsTable.name,
      clientId: campaignsTable.clientId,
      platformId: campaignsTable.platformId,
      createdAt: campaignsTable.createdAt,
      clientName: clientsTable.name,
      platformName: platformsTable.name,
    })
    .from(campaignsTable)
    .leftJoin(clientsTable, eq(campaignsTable.clientId, clientsTable.id))
    .leftJoin(platformsTable, eq(campaignsTable.platformId, platformsTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(campaignsTable.createdAt);

  const parsed = rows.map(r => ({
    id: r.id,
    name: r.name,
    clientId: r.clientId,
    platformId: r.platformId,
    clientName: r.clientName ?? null,
    platformName: r.platformName ?? null,
    createdAt: r.createdAt.toISOString()
  }));

  res.json(ListCampaignsResponse.parse(parsed));
});

router.post("/campaigns", async (req, res): Promise<void> => {
  const parsed = CreateCampaignBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.insert(campaignsTable).values(parsed.data).returning();
  const enriched = await enrichCampaign(row);
  res.status(201).json(GetCampaignResponse.parse(enriched));
});

router.get("/campaigns/:id", async (req, res): Promise<void> => {
  const params = GetCampaignParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  res.json(GetCampaignResponse.parse(await enrichCampaign(row)));
});

router.patch("/campaigns/:id", async (req, res): Promise<void> => {
  const params = UpdateCampaignParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateCampaignBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.update(campaignsTable).set(parsed.data).where(eq(campaignsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  res.json(UpdateCampaignResponse.parse(await enrichCampaign(row)));
});

router.delete("/campaigns/:id", async (req, res): Promise<void> => {
  const params = DeleteCampaignParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.delete(campaignsTable).where(eq(campaignsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Campaign not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
