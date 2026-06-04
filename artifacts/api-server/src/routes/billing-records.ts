import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, billingRecordsTable, clientsTable, platformCostModelsTable, usersTable } from "@workspace/db";
import { optionalAuth } from "../middlewares/auth";
import {
  ListBillingRecordsParams,
  ListBillingRecordsQueryParams,
  ListBillingRecordsResponse,
  CreateBillingRecordParams,
  CreateBillingRecordBody,
  ListBillingRecordsResponseItem,
  DeleteBillingRecordParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function mapRecord(r: typeof billingRecordsTable.$inferSelect) {
  const [client] = await db.select().from(clientsTable).where(eq(clientsTable.id, r.clientId));
  const [cm] = await db
    .select()
    .from(platformCostModelsTable)
    .where(eq(platformCostModelsTable.id, r.costModelId));
  return {
    id: r.id,
    platformId: r.platformId,
    clientId: r.clientId,
    clientName: client?.name ?? null,
    costModelId: r.costModelId,
    costModelName: cm?.name ?? null,
    costModelPayoutRate: cm ? Number(cm.payoutRate) : null,
    costModelMarginPct: cm ? Number(cm.marginPct) : null,
    period: r.period,
    appsflyerPins: r.appsflyerPins,
    fraudPins: r.fraudPins,
    payoutRate: Number(r.payoutRate),
    marginPct: Number(r.marginPct),
    forexRate: Number(r.forexRate),
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
  };
}

router.get("/platforms/:id/billing-records", async (req, res): Promise<void> => {
  const params = ListBillingRecordsParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const query = ListBillingRecordsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const conditions = [eq(billingRecordsTable.platformId, params.data.id)];
  if (query.data.period !== undefined && query.data.period !== null) {
    conditions.push(eq(billingRecordsTable.period, query.data.period));
  }
  if (query.data.clientId !== undefined && query.data.clientId !== null) {
    conditions.push(eq(billingRecordsTable.clientId, query.data.clientId));
  }

  const rows = await db
    .select()
    .from(billingRecordsTable)
    .where(and(...conditions))
    .orderBy(billingRecordsTable.createdAt);
  const mapped = await Promise.all(rows.map(mapRecord));
  res.json(ListBillingRecordsResponse.parse(mapped));
});

router.post("/platforms/:id/billing-records", optionalAuth, async (req, res): Promise<void> => {
  const params = CreateBillingRecordParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreateBillingRecordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    // Resolve the logged-in user's display name (JWT only carries id/email).
    const authUser = req.user;
    let createdBy: string | null = authUser?.email ?? null;
    if (authUser?.id !== undefined) {
      const [user] = await db
        .select({ name: usersTable.name })
        .from(usersTable)
        .where(eq(usersTable.id, authUser.id));
      if (user?.name) createdBy = user.name;
    }

    const [row] = await db
      .insert(billingRecordsTable)
      .values({
        platformId: params.data.id,
        clientId: parsed.data.clientId,
        costModelId: parsed.data.costModelId,
        period: parsed.data.period,
        appsflyerPins: parsed.data.appsflyerPins,
        fraudPins: parsed.data.fraudPins,
        payoutRate: String(parsed.data.payoutRate),
        marginPct: String(parsed.data.marginPct),
        forexRate: String(parsed.data.forexRate),
        createdBy,
      })
      .returning();
    res.status(201).json(ListBillingRecordsResponseItem.parse(await mapRecord(row)));
  } catch (err) {
    console.error("[billing-records POST]", err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create billing record" });
  }
});

router.delete("/platforms/:id/billing-records/:recordId", async (req, res): Promise<void> => {
  const params = DeleteBillingRecordParams.safeParse({
    id: parseInt(req.params.id as string, 10),
    recordId: parseInt(req.params.recordId as string, 10),
  });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .delete(billingRecordsTable)
    .where(
      and(
        eq(billingRecordsTable.id, params.data.recordId),
        eq(billingRecordsTable.platformId, params.data.id),
      ),
    )
    .returning();
  if (!row) {
    res.status(404).json({ error: "Billing record not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
