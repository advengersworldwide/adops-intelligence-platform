import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db, clientPurchaseOrdersTable } from "@workspace/db";
import { mapCpoRow } from "../../../client-purchase-orders/route";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const rows = await db.select().from(clientPurchaseOrdersTable)
    .where(eq(clientPurchaseOrdersTable.clientId, Number(id)))
    .orderBy(desc(clientPurchaseOrdersTable.createdAt));
  return NextResponse.json(await Promise.all(rows.map(mapCpoRow)));
}
