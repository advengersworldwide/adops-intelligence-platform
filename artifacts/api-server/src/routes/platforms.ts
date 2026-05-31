import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, platformsTable } from "@workspace/db";
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

function mapRow(r: typeof platformsTable.$inferSelect) {
  return {
    id: r.id,
    name: r.name,
    costModel: r.costModel,
    currency: r.currency,
    createdAt: r.createdAt.toISOString(),
  };
}

router.get("/platforms", async (req, res): Promise<void> => {
  const rows = await db.select().from(platformsTable).orderBy(platformsTable.createdAt);
  res.json(ListPlatformsResponse.parse(rows.map(mapRow)));
});

router.post("/platforms", async (req, res): Promise<void> => {
  const parsed = CreatePlatformBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.insert(platformsTable).values(parsed.data).returning();
  res.status(201).json(GetPlatformResponse.parse(mapRow(row)));
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
  res.json(GetPlatformResponse.parse(mapRow(row)));
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
  const [row] = await db.update(platformsTable).set(parsed.data).where(eq(platformsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Platform not found" });
    return;
  }
  res.json(UpdatePlatformResponse.parse(mapRow(row)));
});

router.delete("/platforms/:id", async (req, res): Promise<void> => {
  const params = DeletePlatformParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.delete(platformsTable).where(eq(platformsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Platform not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
