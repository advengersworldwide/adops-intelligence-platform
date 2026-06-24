import { NextResponse } from "next/server";
import { db, costModelsTable } from "@workspace/db";
import { CreateCostModelBody, ListCostModelsResponse, ListCostModelsResponseItem } from "@workspace/api-zod";

export const runtime = "nodejs";

function mapRow(r: typeof costModelsTable.$inferSelect) {
  return { id: r.id, name: r.name, createdAt: r.createdAt.toISOString() };
}

export async function GET(): Promise<Response> {
  const rows = await db.select().from(costModelsTable).orderBy(costModelsTable.createdAt);
  return NextResponse.json(ListCostModelsResponse.parse(rows.map(mapRow)));
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = CreateCostModelBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const [row] = await db.insert(costModelsTable).values({ name: parsed.data.name }).returning();
  return NextResponse.json(ListCostModelsResponseItem.parse(mapRow(row)), { status: 201 });
}
