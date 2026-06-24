import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db, clientsTable, clientEventsTable, costModelsTable, partnerClientsTable, partnerEventPayoutsTable } from "@workspace/db";
import {
  ListPartnerClientsParams, ListPartnerClientsResponse, ListPartnerClientsResponseItem,
  LinkPartnerClientParams, LinkPartnerClientBody,
} from "@workspace/api-zod";

export const runtime = "nodejs";

async function buildPartnerClient(pc: typeof partnerClientsTable.$inferSelect, partnerId: number) {
  const [client] = await db.select({ name: clientsTable.name }).from(clientsTable).where(eq(clientsTable.id, pc.clientId));
  const events = await db
    .select({ id: clientEventsTable.id, name: clientEventsTable.name, costModelId: clientEventsTable.costModelId, billableRate: clientEventsTable.billableRate, costModelName: costModelsTable.name })
    .from(clientEventsTable)
    .leftJoin(costModelsTable, eq(clientEventsTable.costModelId, costModelsTable.id))
    .where(eq(clientEventsTable.clientId, pc.clientId))
    .orderBy(clientEventsTable.createdAt);
  const payouts = events.length > 0
    ? await db.select().from(partnerEventPayoutsTable).where(and(eq(partnerEventPayoutsTable.partnerId, partnerId), inArray(partnerEventPayoutsTable.clientEventId, events.map(e => e.id))))
    : [];
  const payoutMap = new Map(payouts.map(p => [p.clientEventId, Number(p.payoutRate)]));
  return {
    id: pc.id, partnerId: pc.partnerId, clientId: pc.clientId,
    clientName: client?.name ?? "", buyingHouseName: null as string | null,
    events: events.map(e => ({ id: e.id, clientEventId: e.id, name: e.name, costModelId: e.costModelId ?? null, costModelName: e.costModelName ?? null, billableRate: Number(e.billableRate), payoutRate: payoutMap.get(e.id) ?? null })),
  };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const p = ListPartnerClientsParams.safeParse({ id: parseInt(id, 10) });
  if (!p.success) return NextResponse.json({ error: p.error.message }, { status: 400 });
  const links = await db.select().from(partnerClientsTable).where(eq(partnerClientsTable.partnerId, p.data.id)).orderBy(partnerClientsTable.createdAt);
  return NextResponse.json(ListPartnerClientsResponse.parse(await Promise.all(links.map(pc => buildPartnerClient(pc, p.data.id)))));
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const p = LinkPartnerClientParams.safeParse({ id: parseInt(id, 10) });
  if (!p.success) return NextResponse.json({ error: p.error.message }, { status: 400 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = LinkPartnerClientBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  try {
    const [existing] = await db.select().from(partnerClientsTable).where(and(eq(partnerClientsTable.partnerId, p.data.id), eq(partnerClientsTable.clientId, parsed.data.clientId)));
    if (existing) return NextResponse.json(ListPartnerClientsResponseItem.parse(await buildPartnerClient(existing, p.data.id)), { status: 201 });
    const [pc] = await db.insert(partnerClientsTable).values({ partnerId: p.data.id, clientId: parsed.data.clientId }).returning();
    return NextResponse.json(ListPartnerClientsResponseItem.parse(await buildPartnerClient(pc, p.data.id)), { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to link client" }, { status: 500 });
  }
}
