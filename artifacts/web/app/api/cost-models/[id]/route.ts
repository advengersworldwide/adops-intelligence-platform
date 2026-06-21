import { eq } from "drizzle-orm";
import { db, costModelsTable } from "@workspace/db";
import { DeleteCostModelParams } from "@workspace/api-zod";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const p = DeleteCostModelParams.safeParse({ id: parseInt(id, 10) });
  if (!p.success) return Response.json({ error: p.error.message }, { status: 400 });
  const [row] = await db.delete(costModelsTable).where(eq(costModelsTable.id, p.data.id)).returning();
  if (!row) return Response.json({ error: "Cost model not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}
