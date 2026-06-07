import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, costResourcesTable } from "@workspace/db";
import {
  ListCostResourcesQueryParams, ListCostResourcesResponse,
  CreateCostResourceBody,
  UpdateCostResourceParams,
  UpdateCostResourceBody, UpdateCostResourceResponse,
  DeleteCostResourceParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

function mapCost(r: typeof costResourcesTable.$inferSelect) {
  return {
    id: r.id,
    name: r.name,
    amount: Number(r.amount),
    period: r.period,
    notes: r.notes ?? null,
    createdBy: r.createdBy ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

router.get("/cost-resources", async (req, res): Promise<void> => {
  const query = ListCostResourcesQueryParams.safeParse(req.query);
  if (!query.success) { res.status(400).json({ error: query.error.message }); return; }
  const rows = await db.select().from(costResourcesTable).orderBy(costResourcesTable.period, costResourcesTable.name);
  const filtered = query.data.period
    ? rows.filter(r => r.period === query.data.period)
    : rows;
  res.json(ListCostResourcesResponse.parse(filtered.map(mapCost)));
});

router.post("/cost-resources", async (req, res): Promise<void> => {
  const parsed = CreateCostResourceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.insert(costResourcesTable).values({
    name: parsed.data.name,
    amount: String(parsed.data.amount),
    period: parsed.data.period,
    notes: parsed.data.notes ?? null,
  }).returning();
  res.status(201).json(UpdateCostResourceResponse.parse(mapCost(row)));
});

router.patch("/cost-resources/:id", async (req, res): Promise<void> => {
  const params = UpdateCostResourceParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateCostResourceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.update(costResourcesTable).set({
    name: parsed.data.name,
    amount: String(parsed.data.amount),
    period: parsed.data.period,
    notes: parsed.data.notes ?? null,
  }).where(eq(costResourcesTable.id, params.data.id)).returning();
  if (!row) { res.status(404).json({ error: "Cost resource not found" }); return; }
  res.json(UpdateCostResourceResponse.parse(mapCost(row)));
});

router.delete("/cost-resources/:id", async (req, res): Promise<void> => {
  const params = DeleteCostResourceParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db.delete(costResourcesTable).where(eq(costResourcesTable.id, params.data.id)).returning();
  if (!row) { res.status(404).json({ error: "Cost resource not found" }); return; }
  res.sendStatus(204);
});

export default router;
