import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, platformCostModelsTable } from "@workspace/db";
import {
  CreatePlatformCostModelParams,
  CreatePlatformCostModelBody,
  UpdatePlatformCostModelParams,
  UpdatePlatformCostModelBody,
  UpdatePlatformCostModelResponse,
  DeletePlatformCostModelParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

function mapCm(cm: typeof platformCostModelsTable.$inferSelect) {
  return {
    id: cm.id,
    platformId: cm.platformId,
    name: cm.name,
    payoutRate: Number(cm.payoutRate),
    createdAt: cm.createdAt.toISOString(),
  };
}

router.post("/platforms/:id/cost-models", async (req, res): Promise<void> => {
  const params = CreatePlatformCostModelParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreatePlatformCostModelBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .insert(platformCostModelsTable)
    .values({
      platformId: params.data.id,
      name: parsed.data.name,
      payoutRate: String(parsed.data.payoutRate),
    })
    .returning();
  res.status(201).json(UpdatePlatformCostModelResponse.parse(mapCm(row)));
});

router.patch("/platforms/:id/cost-models/:cmId", async (req, res): Promise<void> => {
  const params = UpdatePlatformCostModelParams.safeParse({
    id: parseInt(req.params.id as string, 10),
    cmId: parseInt(req.params.cmId as string, 10),
  });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdatePlatformCostModelBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const updates: Partial<typeof platformCostModelsTable.$inferInsert> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.payoutRate !== undefined) updates.payoutRate = String(parsed.data.payoutRate);

  const [row] = await db
    .update(platformCostModelsTable)
    .set(updates)
    .where(
      and(
        eq(platformCostModelsTable.id, params.data.cmId),
        eq(platformCostModelsTable.platformId, params.data.id),
      ),
    )
    .returning();
  if (!row) {
    res.status(404).json({ error: "Cost model not found" });
    return;
  }
  res.json(UpdatePlatformCostModelResponse.parse(mapCm(row)));
});

router.delete("/platforms/:id/cost-models/:cmId", async (req, res): Promise<void> => {
  const params = DeletePlatformCostModelParams.safeParse({
    id: parseInt(req.params.id as string, 10),
    cmId: parseInt(req.params.cmId as string, 10),
  });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .delete(platformCostModelsTable)
    .where(
      and(
        eq(platformCostModelsTable.id, params.data.cmId),
        eq(platformCostModelsTable.platformId, params.data.id),
      ),
    )
    .returning();
  if (!row) {
    res.status(404).json({ error: "Cost model not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
