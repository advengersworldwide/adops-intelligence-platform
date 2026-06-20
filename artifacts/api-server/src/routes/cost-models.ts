import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, costModelsTable } from "@workspace/db";
import {
  CreateCostModelBody,
  DeleteCostModelParams,
  ListCostModelsResponse,
  ListCostModelsResponseItem,
} from "@workspace/api-zod";

const router: IRouter = Router();

function mapRow(r: typeof costModelsTable.$inferSelect) {
  return { id: r.id, name: r.name, createdAt: r.createdAt.toISOString() };
}

router.get("/cost-models", async (_req, res): Promise<void> => {
  const rows = await db.select().from(costModelsTable).orderBy(costModelsTable.createdAt);
  res.json(ListCostModelsResponse.parse(rows.map(mapRow)));
});

router.post("/cost-models", async (req, res): Promise<void> => {
  const parsed = CreateCostModelBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.insert(costModelsTable).values({ name: parsed.data.name }).returning();
  res.status(201).json(ListCostModelsResponseItem.parse(mapRow(row)));
});

router.delete("/cost-models/:id", async (req, res): Promise<void> => {
  const params = DeleteCostModelParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db.delete(costModelsTable).where(eq(costModelsTable.id, params.data.id)).returning();
  if (!row) { res.status(404).json({ error: "Cost model not found" }); return; }
  res.sendStatus(204);
});

export default router;
