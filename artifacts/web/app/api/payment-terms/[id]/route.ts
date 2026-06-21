import { eq } from "drizzle-orm";
import { db, paymentTermsTable } from "@workspace/db";
import { DeletePaymentTermParams } from "@workspace/api-zod";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const p = DeletePaymentTermParams.safeParse({ id: parseInt(id, 10) });
  if (!p.success) return Response.json({ error: p.error.message }, { status: 400 });
  const [row] = await db.delete(paymentTermsTable).where(eq(paymentTermsTable.id, p.data.id)).returning();
  if (!row) return Response.json({ error: "Payment term not found" }, { status: 404 });
  return new Response(null, { status: 204 });
}
