import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, transactionsTable } from "@workspace/db";
import { DeleteTransactionParams } from "@workspace/api-zod";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const p = DeleteTransactionParams.safeParse({ id: parseInt(id, 10) });
  if (!p.success) return NextResponse.json({ error: p.error.message }, { status: 400 });
  const [row] = await db.delete(transactionsTable).where(eq(transactionsTable.id, p.data.id)).returning();
  if (!row) return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}
