import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, clientEventsTable, costModelsTable, partnerEventPayoutsTable } from "@workspace/db";
import { SetPartnerEventPayoutParams, SetPartnerEventPayoutBody, SetPartnerEventPayoutResponse } from "@workspace/api-zod";
import { requirePermission, isAuthError } from "@/lib/auth/require";

export const runtime = "nodejs";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string; clientId: string; eventId: string }> },
): Promise<Response> {
  const auth = await requirePermission("payments:edit");
  if (isAuthError(auth)) return auth;
  const { id, clientId, eventId } = await params;
  const p = SetPartnerEventPayoutParams.safeParse({ id: parseInt(id, 10), clientId: parseInt(clientId, 10), eventId: parseInt(eventId, 10) });
  if (!p.success) return NextResponse.json({ error: p.error.message }, { status: 400 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = SetPartnerEventPayoutBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const [event] = await db
    .select({ id: clientEventsTable.id, name: clientEventsTable.name, costModelId: clientEventsTable.costModelId, billableRate: clientEventsTable.billableRate, costModelName: costModelsTable.name })
    .from(clientEventsTable)
    .leftJoin(costModelsTable, eq(clientEventsTable.costModelId, costModelsTable.id))
    .where(and(eq(clientEventsTable.id, p.data.eventId), eq(clientEventsTable.clientId, p.data.clientId)));
  if (!event) return NextResponse.json({ error: "Event not found" }, { status: 404 });

  await db.insert(partnerEventPayoutsTable).values({
    partnerId: p.data.id, clientEventId: p.data.eventId, payoutRate: String(parsed.data.payoutRate),
  }).onConflictDoUpdate({
    target: [partnerEventPayoutsTable.partnerId, partnerEventPayoutsTable.clientEventId],
    set: { payoutRate: String(parsed.data.payoutRate) },
  });

  return NextResponse.json(SetPartnerEventPayoutResponse.parse({
    id: event.id, clientEventId: event.id, name: event.name,
    costModelId: event.costModelId ?? null, costModelName: event.costModelName ?? null,
    billableRate: Number(event.billableRate), payoutRate: parsed.data.payoutRate,
  }));
}
