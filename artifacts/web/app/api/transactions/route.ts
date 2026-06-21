import { NextResponse } from "next/server";
import { and, eq, gte, lte } from "drizzle-orm";
import { db, transactionsTable, campaignsTable, clientsTable, partnersTable } from "@workspace/db";
import { CreateTransactionBody, ListTransactionsQueryParams, ListTransactionsResponse } from "@workspace/api-zod";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const qp = ListTransactionsQueryParams.safeParse(Object.fromEntries(url.searchParams));
  if (!qp.success) return NextResponse.json({ error: qp.error.message }, { status: 400 });

  let query = db.select({
    id: transactionsTable.id, campaignId: transactionsTable.campaignId,
    date: transactionsTable.date, spend: transactionsTable.spend,
    cost: transactionsTable.cost, profit: transactionsTable.profit,
    createdAt: transactionsTable.createdAt, campaignName: campaignsTable.name,
    clientId: campaignsTable.clientId, platformId: campaignsTable.platformId,
  }).from(transactionsTable).leftJoin(campaignsTable, eq(transactionsTable.campaignId, campaignsTable.id)).$dynamic();

  const conditions = [];
  if (qp.data.campaignId != null) conditions.push(eq(transactionsTable.campaignId, qp.data.campaignId));
  if (qp.data.dateFrom != null) conditions.push(gte(transactionsTable.date, qp.data.dateFrom));
  if (qp.data.dateTo != null) conditions.push(lte(transactionsTable.date, qp.data.dateTo));
  if (qp.data.clientId != null) conditions.push(eq(campaignsTable.clientId, qp.data.clientId));
  if (qp.data.platformId != null) conditions.push(eq(campaignsTable.platformId, qp.data.platformId));
  if (conditions.length > 0) query = query.where(and(...conditions));

  const rows = await query.orderBy(transactionsTable.date);

  const clientIds = [...new Set(rows.map(r => r.clientId).filter(Boolean))] as number[];
  const platformIds = [...new Set(rows.map(r => r.platformId).filter(Boolean))] as number[];
  const clientMap = new Map<number, string>();
  const platformMap = new Map<number, string>();
  if (clientIds.length > 0) { const clients = await db.select({ id: clientsTable.id, name: clientsTable.name }).from(clientsTable); clients.forEach(c => clientMap.set(c.id, c.name)); }
  if (platformIds.length > 0) { const platforms = await db.select({ id: partnersTable.id, name: partnersTable.name }).from(partnersTable); platforms.forEach(p => platformMap.set(p.id, p.name)); }

  const result = rows.map(r => {
    const spend = parseFloat(r.spend); const cost = parseFloat(r.cost); const profit = parseFloat(r.profit);
    return { id: r.id, campaignId: r.campaignId, campaignName: r.campaignName ?? null, clientId: r.clientId ?? null, clientName: r.clientId ? (clientMap.get(r.clientId) ?? null) : null, platformId: r.platformId ?? null, platformName: r.platformId ? (platformMap.get(r.platformId) ?? null) : null, date: r.date, spend, cost, profit, marginPct: spend > 0 ? (profit / spend) * 100 : null, createdAt: r.createdAt.toISOString() };
  });

  return NextResponse.json(ListTransactionsResponse.parse(result));
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = CreateTransactionBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const spend = parsed.data.spend, cost = parsed.data.cost, profit = spend - cost;
  const [row] = await db.insert(transactionsTable).values({ campaignId: parsed.data.campaignId, date: parsed.data.date, spend: String(spend), cost: String(cost), profit: String(profit) }).returning();

  const [campaign] = await db.select({ name: campaignsTable.name, clientId: campaignsTable.clientId, platformId: campaignsTable.platformId }).from(campaignsTable).where(eq(campaignsTable.id, row.campaignId));
  let clientName: string | null = null, platformName: string | null = null;
  if (campaign) {
    const [client] = await db.select({ name: clientsTable.name }).from(clientsTable).where(eq(clientsTable.id, campaign.clientId));
    const [platform] = await db.select({ name: partnersTable.name }).from(partnersTable).where(eq(partnersTable.id, campaign.platformId));
    clientName = client?.name ?? null; platformName = platform?.name ?? null;
  }
  return NextResponse.json({ id: row.id, campaignId: row.campaignId, campaignName: campaign?.name ?? null, clientId: campaign?.clientId ?? null, clientName, platformId: campaign?.platformId ?? null, platformName, date: row.date, spend, cost, profit, marginPct: spend > 0 ? (profit / spend) * 100 : null, createdAt: row.createdAt.toISOString() }, { status: 201 });
}
