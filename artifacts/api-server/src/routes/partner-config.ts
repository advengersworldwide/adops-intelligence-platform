import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  db, clientsTable, clientEventsTable, costModelsTable,
  partnerClientsTable, partnerEventPayoutsTable,
} from "@workspace/db";
import {
  ListPartnerClientsParams,
  ListPartnerClientsResponse,
  ListPartnerClientsResponseItem,
  LinkPartnerClientParams,
  LinkPartnerClientBody,
  UnlinkPartnerClientParams,
  SetPartnerEventPayoutParams,
  SetPartnerEventPayoutBody,
  SetPartnerEventPayoutResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function buildPartnerClient(
  pc: typeof partnerClientsTable.$inferSelect,
  partnerId: number,
) {
  const [client] = await db
    .select({ name: clientsTable.name })
    .from(clientsTable)
    .where(eq(clientsTable.id, pc.clientId));

  const events = await db
    .select({
      id: clientEventsTable.id,
      name: clientEventsTable.name,
      costModelId: clientEventsTable.costModelId,
      billableRate: clientEventsTable.billableRate,
      costModelName: costModelsTable.name,
    })
    .from(clientEventsTable)
    .leftJoin(costModelsTable, eq(clientEventsTable.costModelId, costModelsTable.id))
    .where(eq(clientEventsTable.clientId, pc.clientId))
    .orderBy(clientEventsTable.createdAt);

  const payouts = events.length > 0
    ? await db
        .select()
        .from(partnerEventPayoutsTable)
        .where(and(
          eq(partnerEventPayoutsTable.partnerId, partnerId),
          inArray(partnerEventPayoutsTable.clientEventId, events.map(e => e.id)),
        ))
    : [];

  const payoutMap = new Map(payouts.map(p => [p.clientEventId, Number(p.payoutRate)]));

  return {
    id: pc.id,
    partnerId: pc.partnerId,
    clientId: pc.clientId,
    clientName: client?.name ?? "",
    buyingHouseName: null as string | null,
    events: events.map(e => ({
      id: e.id,
      clientEventId: e.id,
      name: e.name,
      costModelId: e.costModelId ?? null,
      costModelName: e.costModelName ?? null,
      billableRate: Number(e.billableRate),
      payoutRate: payoutMap.get(e.id) ?? null,
    })),
  };
}

router.get("/partners/:id/clients", async (req, res): Promise<void> => {
  const params = ListPartnerClientsParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const links = await db
    .select()
    .from(partnerClientsTable)
    .where(eq(partnerClientsTable.partnerId, params.data.id))
    .orderBy(partnerClientsTable.createdAt);

  const mapped = await Promise.all(links.map(pc => buildPartnerClient(pc, params.data.id)));
  res.json(ListPartnerClientsResponse.parse(mapped));
});

router.post("/partners/:id/clients", async (req, res): Promise<void> => {
  const params = LinkPartnerClientParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = LinkPartnerClientBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  try {
    const [existing] = await db
      .select()
      .from(partnerClientsTable)
      .where(and(
        eq(partnerClientsTable.partnerId, params.data.id),
        eq(partnerClientsTable.clientId, parsed.data.clientId),
      ));
    if (existing) {
      res.status(201).json(ListPartnerClientsResponseItem.parse(await buildPartnerClient(existing, params.data.id)));
      return;
    }
    const [pc] = await db.insert(partnerClientsTable).values({
      partnerId: params.data.id,
      clientId: parsed.data.clientId,
    }).returning();
    res.status(201).json(ListPartnerClientsResponseItem.parse(await buildPartnerClient(pc, params.data.id)));
  } catch (err) {
    console.error("[partner-config POST /clients]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to link client" });
  }
});

router.delete("/partners/:id/clients/:clientId", async (req, res): Promise<void> => {
  const params = UnlinkPartnerClientParams.safeParse({
    id: parseInt(req.params.id as string, 10),
    clientId: parseInt(req.params.clientId as string, 10),
  });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const clientEvents = await db
    .select({ id: clientEventsTable.id })
    .from(clientEventsTable)
    .where(eq(clientEventsTable.clientId, params.data.clientId));

  if (clientEvents.length > 0) {
    await db.delete(partnerEventPayoutsTable).where(and(
      eq(partnerEventPayoutsTable.partnerId, params.data.id),
      inArray(partnerEventPayoutsTable.clientEventId, clientEvents.map(e => e.id)),
    ));
  }

  const [row] = await db.delete(partnerClientsTable).where(and(
    eq(partnerClientsTable.partnerId, params.data.id),
    eq(partnerClientsTable.clientId, params.data.clientId),
  )).returning();

  if (!row) { res.status(404).json({ error: "Link not found" }); return; }
  res.sendStatus(204);
});

router.put("/partners/:id/clients/:clientId/events/:eventId/payout", async (req, res): Promise<void> => {
  const params = SetPartnerEventPayoutParams.safeParse({
    id: parseInt(req.params.id as string, 10),
    clientId: parseInt(req.params.clientId as string, 10),
    eventId: parseInt(req.params.eventId as string, 10),
  });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = SetPartnerEventPayoutBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [event] = await db
    .select({
      id: clientEventsTable.id,
      name: clientEventsTable.name,
      costModelId: clientEventsTable.costModelId,
      billableRate: clientEventsTable.billableRate,
      costModelName: costModelsTable.name,
    })
    .from(clientEventsTable)
    .leftJoin(costModelsTable, eq(clientEventsTable.costModelId, costModelsTable.id))
    .where(and(
      eq(clientEventsTable.id, params.data.eventId),
      eq(clientEventsTable.clientId, params.data.clientId),
    ));

  if (!event) { res.status(404).json({ error: "Event not found" }); return; }

  await db.insert(partnerEventPayoutsTable).values({
    partnerId: params.data.id,
    clientEventId: params.data.eventId,
    payoutRate: String(parsed.data.payoutRate),
  }).onConflictDoUpdate({
    target: [partnerEventPayoutsTable.partnerId, partnerEventPayoutsTable.clientEventId],
    set: { payoutRate: String(parsed.data.payoutRate) },
  });

  res.json(SetPartnerEventPayoutResponse.parse({
    id: event.id,
    clientEventId: event.id,
    name: event.name,
    costModelId: event.costModelId ?? null,
    costModelName: event.costModelName ?? null,
    billableRate: Number(event.billableRate),
    payoutRate: parsed.data.payoutRate,
  }));
});

export default router;
