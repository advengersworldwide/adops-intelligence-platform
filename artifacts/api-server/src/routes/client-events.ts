import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, clientEventsTable, costModelsTable } from "@workspace/db";
import {
  ListClientEventsParams,
  ListClientEventsResponse,
  CreateClientEventParams,
  CreateClientEventBody,
  UpdateClientEventParams,
  UpdateClientEventBody,
  UpdateClientEventResponse,
  DeleteClientEventParams,
  ListClientEventsResponseItem,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function mapEvent(r: typeof clientEventsTable.$inferSelect) {
  let costModelName: string | null = null;
  if (r.costModelId != null) {
    const [cm] = await db.select({ name: costModelsTable.name }).from(costModelsTable).where(eq(costModelsTable.id, r.costModelId));
    costModelName = cm?.name ?? null;
  }
  return {
    id: r.id,
    clientId: r.clientId,
    name: r.name,
    costModelId: r.costModelId ?? null,
    costModelName,
    billableRate: Number(r.billableRate),
    createdAt: r.createdAt.toISOString(),
  };
}

router.get("/clients/:id/events", async (req, res): Promise<void> => {
  const params = ListClientEventsParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const rows = await db.select().from(clientEventsTable)
    .where(eq(clientEventsTable.clientId, params.data.id))
    .orderBy(clientEventsTable.createdAt);
  res.json(ListClientEventsResponse.parse(await Promise.all(rows.map(mapEvent))));
});

router.post("/clients/:id/events", async (req, res): Promise<void> => {
  const params = CreateClientEventParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = CreateClientEventBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const [row] = await db.insert(clientEventsTable).values({
    clientId: params.data.id,
    name: parsed.data.name,
    costModelId: parsed.data.costModelId ?? null,
    billableRate: String(parsed.data.billableRate),
  }).returning();
  res.status(201).json(ListClientEventsResponseItem.parse(await mapEvent(row)));
});

router.patch("/clients/:id/events/:eventId", async (req, res): Promise<void> => {
  const params = UpdateClientEventParams.safeParse({
    id: parseInt(req.params.id as string, 10),
    eventId: parseInt(req.params.eventId as string, 10),
  });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateClientEventBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const updates: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.costModelId !== undefined) updates.costModelId = parsed.data.costModelId;
  if (parsed.data.billableRate !== undefined) updates.billableRate = String(parsed.data.billableRate);
  const [row] = await db.update(clientEventsTable).set(updates)
    .where(and(eq(clientEventsTable.id, params.data.eventId), eq(clientEventsTable.clientId, params.data.id)))
    .returning();
  if (!row) { res.status(404).json({ error: "Event not found" }); return; }
  res.json(UpdateClientEventResponse.parse(await mapEvent(row)));
});

router.delete("/clients/:id/events/:eventId", async (req, res): Promise<void> => {
  const params = DeleteClientEventParams.safeParse({
    id: parseInt(req.params.id as string, 10),
    eventId: parseInt(req.params.eventId as string, 10),
  });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [row] = await db.delete(clientEventsTable)
    .where(and(eq(clientEventsTable.id, params.data.eventId), eq(clientEventsTable.clientId, params.data.id)))
    .returning();
  if (!row) { res.status(404).json({ error: "Event not found" }); return; }
  res.sendStatus(204);
});

export default router;
