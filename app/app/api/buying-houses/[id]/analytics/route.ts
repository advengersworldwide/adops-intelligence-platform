import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, buyingHousesTable, billingRecordsTable, clientsTable } from "@workspace/db";
import { computeRow } from "@/lib/compute-row";
import { GetBuyingHouseAnalyticsParams, GetBuyingHouseAnalyticsResponse } from "@workspace/api-zod";
import { requirePermission, isAuthError } from "@/lib/auth/require";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requirePermission("buying-houses:view");
  if (isAuthError(auth)) return auth;
  const { id } = await params;
  const p = GetBuyingHouseAnalyticsParams.safeParse({ id: parseInt(id, 10) });
  if (!p.success) return NextResponse.json({ error: p.error.message }, { status: 400 });
  const [bh] = await db.select().from(buyingHousesTable).where(eq(buyingHousesTable.id, p.data.id));
  if (!bh) return NextResponse.json({ error: "Buying house not found" }, { status: 404 });

  const records = await db.select().from(billingRecordsTable).where(eq(billingRecordsTable.buyingHouseId, p.data.id));
  let totalReceivablePkr = 0, totalPayablePkr = 0;
  const periodMap = new Map<string, { receivablePkr: number; payablePkr: number; netMarginPkr: number }>();

  for (const r of records) {
    const c = computeRow(r);
    totalReceivablePkr += c.receivablePkr;
    totalPayablePkr += c.totalPayablePkr;
    const prev = periodMap.get(r.period) ?? { receivablePkr: 0, payablePkr: 0, netMarginPkr: 0 };
    periodMap.set(r.period, { receivablePkr: prev.receivablePkr + c.receivablePkr, payablePkr: prev.payablePkr + c.totalPayablePkr, netMarginPkr: prev.netMarginPkr + c.netMarginPkr });
  }

  const netMarginPkr = totalReceivablePkr - totalPayablePkr;
  const marginPct = totalReceivablePkr > 0 ? (netMarginPkr / totalReceivablePkr) * 100 : 0;
  const monthlyTrend = Array.from(periodMap.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([period, vals]) => ({ period, ...vals }));
  const clientRows = await db.select({ id: clientsTable.id, name: clientsTable.name }).from(clientsTable).where(eq(clientsTable.buyingHouseId, p.data.id));

  return NextResponse.json(GetBuyingHouseAnalyticsResponse.parse({ totalReceivablePkr, totalPayablePkr, netMarginPkr, marginPct, monthlyTrend, clients: clientRows }));
}
