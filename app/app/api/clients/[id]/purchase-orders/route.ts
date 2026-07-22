import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db, clientPurchaseOrdersTable } from "@workspace/db";
import { mapCpoRow } from "../../../client-purchase-orders/route";
import { requirePermission, isAuthError } from "@/lib/auth/require";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const auth = await requirePermission("purchase-orders:view");
  if (isAuthError(auth)) return auth;
  const { id } = await params;
  const period = new URL(req.url).searchParams.get("period"); // "YYYY-MM"
  const rows = await db.select().from(clientPurchaseOrdersTable)
    .where(eq(clientPurchaseOrdersTable.clientId, Number(id)))
    .orderBy(desc(clientPurchaseOrdersTable.createdAt));
  const filtered = period
    ? rows.filter(r => {
        const [y, m] = period.split("-");
        return r.code.includes(`-${m}${y.slice(2)}-`); // PREFIX-MMYY-NNNN
      })
    : rows;
  return NextResponse.json(await Promise.all(filtered.map(mapCpoRow)));
}
