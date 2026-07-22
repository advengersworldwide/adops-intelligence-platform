import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db, clientEventsTable, partnerClientsTable, partnerEventPayoutsTable } from "@workspace/db";
import { UnlinkPartnerClientParams } from "@workspace/api-zod";
import { requirePermission, isAuthError } from "@/lib/auth/require";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; clientId: string }> },
): Promise<Response> {
  const auth = await requirePermission("partners:edit");
  if (isAuthError(auth)) return auth;
  const { id, clientId } = await params;
  const p = UnlinkPartnerClientParams.safeParse({ id: parseInt(id, 10), clientId: parseInt(clientId, 10) });
  if (!p.success) return NextResponse.json({ error: p.error.message }, { status: 400 });
  const clientEvents = await db.select({ id: clientEventsTable.id }).from(clientEventsTable).where(eq(clientEventsTable.clientId, p.data.clientId));
  if (clientEvents.length > 0) {
    await db.delete(partnerEventPayoutsTable).where(and(
      eq(partnerEventPayoutsTable.partnerId, p.data.id),
      inArray(partnerEventPayoutsTable.clientEventId, clientEvents.map(e => e.id)),
    ));
  }
  const [row] = await db.delete(partnerClientsTable).where(and(
    eq(partnerClientsTable.partnerId, p.data.id),
    eq(partnerClientsTable.clientId, p.data.clientId),
  )).returning();
  if (!row) return NextResponse.json({ error: "Link not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}
