import { NextResponse } from "next/server";
import { db, costResourcesTable } from "@workspace/db";
import { ListCostResourcesQueryParams, ListCostResourcesResponse, CreateCostResourceBody, UpdateCostResourceResponse } from "@workspace/api-zod";

export const runtime = "nodejs";

function mapCost(r: typeof costResourcesTable.$inferSelect) {
  return { id: r.id, name: r.name, amount: Number(r.amount), period: r.period, notes: r.notes ?? null, createdBy: r.createdBy ?? null, createdAt: r.createdAt.toISOString() };
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const query = ListCostResourcesQueryParams.safeParse(Object.fromEntries(url.searchParams));
  if (!query.success) return NextResponse.json({ error: query.error.message }, { status: 400 });
  const rows = await db.select().from(costResourcesTable).orderBy(costResourcesTable.period, costResourcesTable.name);
  const filtered = query.data.period ? rows.filter(r => r.period === query.data.period) : rows;
  return NextResponse.json(ListCostResourcesResponse.parse(filtered.map(mapCost)));
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = CreateCostResourceBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const [row] = await db.insert(costResourcesTable).values({ name: parsed.data.name, amount: String(parsed.data.amount), period: parsed.data.period, notes: parsed.data.notes ?? null }).returning();
  return NextResponse.json(UpdateCostResourceResponse.parse(mapCost(row)), { status: 201 });
}
