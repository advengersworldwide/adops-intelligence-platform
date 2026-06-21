import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, clientEventsTable, costModelsTable } from "@workspace/db";
import { UpdateClientEventParams, UpdateClientEventBody, DeleteClientEventParams, UpdateClientEventResponse } from "@workspace/api-zod";

export const runtime = "nodejs";

async function mapEvent(r: typeof clientEventsTable.$inferSelect) {
  let costModelName: string | null = null;
  if (r.costModelId != null) {
    const [cm] = await db.select({ name: costModelsTable.name }).from(costModelsTable).where(eq(costModelsTable.id, r.costModelId));
    costModelName = cm?.name ?? null;
  }
  return { id: r.id, clientId: r.clientId, name: r.name, costModelId: r.costModelId ?? null, costModelName, billableRate: Number(r.billableRate), createdAt: r.createdAt.toISOString() };
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; eventId: string }> },
): Promise<Response> {
  const { id, eventId } = await params;
  const p = UpdateClientEventParams.safeParse({ id: parseInt(id, 10), eventId: parseInt(eventId, 10) });
  if (!p.success) return NextResponse.json({ error: p.error.message }, { status: 400 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = UpdateClientEventBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const updates: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.costModelId !== undefined) updates.costModelId = parsed.data.costModelId;
  if (parsed.data.billableRate !== undefined) updates.billableRate = String(parsed.data.billableRate);
  const [row] = await db.update(clientEventsTable).set(updates)
    .where(and(eq(clientEventsTable.id, p.data.eventId), eq(clientEventsTable.clientId, p.data.id)))
    .returning();
  if (!row) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  return NextResponse.json(UpdateClientEventResponse.parse(await mapEvent(row)));
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; eventId: string }> },
): Promise<Response> {
  const { id, eventId } = await params;
  const p = DeleteClientEventParams.safeParse({ id: parseInt(id, 10), eventId: parseInt(eventId, 10) });
  if (!p.success) return NextResponse.json({ error: p.error.message }, { status: 400 });
  const [row] = await db.delete(clientEventsTable)
    .where(and(eq(clientEventsTable.id, p.data.eventId), eq(clientEventsTable.clientId, p.data.id)))
    .returning();
  if (!row) return NextResponse.json({ error: "Event not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}
