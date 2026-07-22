import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, clientEventsTable, costModelsTable } from "@workspace/db";
import { ListClientEventsParams, CreateClientEventParams, CreateClientEventBody, ListClientEventsResponse, ListClientEventsResponseItem } from "@workspace/api-zod";
import { requirePermission, isAuthError } from "@/lib/auth/require";

export const runtime = "nodejs";

async function mapEvent(r: typeof clientEventsTable.$inferSelect) {
  let costModelName: string | null = null;
  if (r.costModelId != null) {
    const [cm] = await db.select({ name: costModelsTable.name }).from(costModelsTable).where(eq(costModelsTable.id, r.costModelId));
    costModelName = cm?.name ?? null;
  }
  return { id: r.id, clientId: r.clientId, name: r.name, costModelId: r.costModelId ?? null, costModelName, billableRate: Number(r.billableRate), createdAt: r.createdAt.toISOString() };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requirePermission("clients:view");
  if (isAuthError(auth)) return auth;
  const { id } = await params;
  const p = ListClientEventsParams.safeParse({ id: parseInt(id, 10) });
  if (!p.success) return NextResponse.json({ error: p.error.message }, { status: 400 });
  const rows = await db.select().from(clientEventsTable).where(eq(clientEventsTable.clientId, p.data.id)).orderBy(clientEventsTable.createdAt);
  return NextResponse.json(ListClientEventsResponse.parse(await Promise.all(rows.map(mapEvent))));
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requirePermission("clients:edit");
  if (isAuthError(auth)) return auth;
  const { id } = await params;
  const p = CreateClientEventParams.safeParse({ id: parseInt(id, 10) });
  if (!p.success) return NextResponse.json({ error: p.error.message }, { status: 400 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = CreateClientEventBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const [row] = await db.insert(clientEventsTable).values({
    clientId: p.data.id, name: parsed.data.name,
    costModelId: parsed.data.costModelId ?? null,
    billableRate: String(parsed.data.billableRate),
  }).returning();
  return NextResponse.json(ListClientEventsResponseItem.parse(await mapEvent(row)), { status: 201 });
}
