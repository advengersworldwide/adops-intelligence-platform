import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { db, clientEventsTable, partnerEventPayoutsTable } from "@workspace/db";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const clientId = new URL(req.url).searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId is required" }, { status: 400 });

  const rows = await db
    .select({
      clientEventId: clientEventsTable.id,
      name: clientEventsTable.name,
      billableRate: clientEventsTable.billableRate,
      payoutRate: partnerEventPayoutsTable.payoutRate,
    })
    .from(clientEventsTable)
    .innerJoin(partnerEventPayoutsTable, and(
      eq(partnerEventPayoutsTable.clientEventId, clientEventsTable.id),
      eq(partnerEventPayoutsTable.partnerId, Number(id)),
    ))
    .where(eq(clientEventsTable.clientId, Number(clientId)));

  return NextResponse.json(rows.map(r => ({
    clientEventId: r.clientEventId, name: r.name,
    billableRate: Number(r.billableRate), payoutRate: Number(r.payoutRate),
  })));
}
