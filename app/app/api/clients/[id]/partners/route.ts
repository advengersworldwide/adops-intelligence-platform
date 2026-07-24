import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, partnerClientsTable, partnersTable } from "@workspace/db";
import { requirePermission, isAuthError } from "@/lib/auth/require";

export const runtime = "nodejs";

// Partners linked to a client (via partner_clients), for the client detail page.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await requirePermission("clients:view");
  if (isAuthError(auth)) return auth;
  const { id } = await params;
  const clientId = parseInt(id, 10);
  if (!Number.isFinite(clientId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  const rows = await db
    .select({ id: partnersTable.id, name: partnersTable.name, codePrefix: partnersTable.codePrefix })
    .from(partnerClientsTable)
    .innerJoin(partnersTable, eq(partnerClientsTable.partnerId, partnersTable.id))
    .where(eq(partnerClientsTable.clientId, clientId))
    .orderBy(partnersTable.name);
  return NextResponse.json(rows.map((r) => ({ id: r.id, name: r.name, codePrefix: r.codePrefix ?? null })));
}
