import { Router, type IRouter } from "express";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import { db, transactionsTable, campaignsTable, clientsTable, platformsTable } from "@workspace/db";
import {
  CreateTransactionBody,
  DeleteTransactionParams,
  ListTransactionsQueryParams,
  ListTransactionsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function enrichTransaction(row: typeof transactionsTable.$inferSelect) {
  const [campaign] = await db
    .select({
      name: campaignsTable.name,
      clientId: campaignsTable.clientId,
      platformId: campaignsTable.platformId,
    })
    .from(campaignsTable)
    .where(eq(campaignsTable.id, row.campaignId));

  let clientName: string | null = null;
  let platformName: string | null = null;

  if (campaign) {
    const [client] = await db.select({ name: clientsTable.name }).from(clientsTable).where(eq(clientsTable.id, campaign.clientId));
    const [platform] = await db.select({ name: platformsTable.name }).from(platformsTable).where(eq(platformsTable.id, campaign.platformId));
    clientName = client?.name ?? null;
    platformName = platform?.name ?? null;
  }

  const spend = parseFloat(row.spend);
  const cost = parseFloat(row.cost);
  const profit = parseFloat(row.profit);
  const marginPct = spend > 0 ? (profit / spend) * 100 : null;

  return {
    id: row.id,
    campaignId: row.campaignId,
    campaignName: campaign?.name ?? null,
    clientId: campaign?.clientId ?? null,
    clientName,
    platformId: campaign?.platformId ?? null,
    platformName,
    date: row.date,
    spend,
    cost,
    profit,
    marginPct,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get("/transactions", async (req, res): Promise<void> => {
  const qp = ListTransactionsQueryParams.safeParse(req.query);
  if (!qp.success) {
    res.status(400).json({ error: qp.error.message });
    return;
  }

  // Get transactions with join
  let query = db
    .select({
      id: transactionsTable.id,
      campaignId: transactionsTable.campaignId,
      date: transactionsTable.date,
      spend: transactionsTable.spend,
      cost: transactionsTable.cost,
      profit: transactionsTable.profit,
      createdAt: transactionsTable.createdAt,
      campaignName: campaignsTable.name,
      clientId: campaignsTable.clientId,
      platformId: campaignsTable.platformId,
    })
    .from(transactionsTable)
    .leftJoin(campaignsTable, eq(transactionsTable.campaignId, campaignsTable.id))
    .$dynamic();

  const conditions = [];
  if (qp.data.campaignId !== null && qp.data.campaignId !== undefined) {
    conditions.push(eq(transactionsTable.campaignId, qp.data.campaignId));
  }
  if (qp.data.dateFrom !== null && qp.data.dateFrom !== undefined) {
    conditions.push(gte(transactionsTable.date, qp.data.dateFrom));
  }
  if (qp.data.dateTo !== null && qp.data.dateTo !== undefined) {
    conditions.push(lte(transactionsTable.date, qp.data.dateTo));
  }
  if (qp.data.clientId !== null && qp.data.clientId !== undefined) {
    conditions.push(eq(campaignsTable.clientId, qp.data.clientId));
  }
  if (qp.data.platformId !== null && qp.data.platformId !== undefined) {
    conditions.push(eq(campaignsTable.platformId, qp.data.platformId));
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  const rows = await query.orderBy(transactionsTable.date);

  // Enrich with client/platform names
  const clientIds = [...new Set(rows.map(r => r.clientId).filter(Boolean))] as number[];
  const platformIds = [...new Set(rows.map(r => r.platformId).filter(Boolean))] as number[];

  const clientMap = new Map<number, string>();
  const platformMap = new Map<number, string>();

  if (clientIds.length > 0) {
    const clients = await db.select({ id: clientsTable.id, name: clientsTable.name }).from(clientsTable);
    clients.forEach(c => clientMap.set(c.id, c.name));
  }
  if (platformIds.length > 0) {
    const platforms = await db.select({ id: platformsTable.id, name: platformsTable.name }).from(platformsTable);
    platforms.forEach(p => platformMap.set(p.id, p.name));
  }

  const result = rows.map(r => {
    const spend = parseFloat(r.spend);
    const cost = parseFloat(r.cost);
    const profit = parseFloat(r.profit);
    const marginPct = spend > 0 ? (profit / spend) * 100 : null;
    return {
      id: r.id,
      campaignId: r.campaignId,
      campaignName: r.campaignName ?? null,
      clientId: r.clientId ?? null,
      clientName: r.clientId ? (clientMap.get(r.clientId) ?? null) : null,
      platformId: r.platformId ?? null,
      platformName: r.platformId ? (platformMap.get(r.platformId) ?? null) : null,
      date: r.date,
      spend,
      cost,
      profit,
      marginPct,
      createdAt: r.createdAt.toISOString(),
    };
  });

  res.json(ListTransactionsResponse.parse(result));
});

router.post("/transactions", async (req, res): Promise<void> => {
  const parsed = CreateTransactionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const spend = parsed.data.spend;
  const cost = parsed.data.cost;
  const profit = spend - cost;

  const [row] = await db.insert(transactionsTable).values({
    campaignId: parsed.data.campaignId,
    date: parsed.data.date,
    spend: String(spend),
    cost: String(cost),
    profit: String(profit),
  }).returning();

  const enriched = await enrichTransaction(row);
  res.status(201).json(enriched);
});

router.delete("/transactions/:id", async (req, res): Promise<void> => {
  const params = DeleteTransactionParams.safeParse({ id: parseInt(req.params.id as string, 10) });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db.delete(transactionsTable).where(eq(transactionsTable.id, params.data.id)).returning();
  if (!row) {
    res.status(404).json({ error: "Transaction not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
