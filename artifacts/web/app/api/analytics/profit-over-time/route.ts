import { NextResponse } from "next/server";
import { and, gte, lte, sql } from "drizzle-orm";
import { db, transactionsTable } from "@workspace/db";
import { GetProfitOverTimeQueryParams, GetProfitOverTimeResponse } from "@workspace/api-zod";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const qp = GetProfitOverTimeQueryParams.safeParse(Object.fromEntries(url.searchParams));
  if (!qp.success) return NextResponse.json({ error: qp.error.message }, { status: 400 });

  const conditions = [];
  if (qp.data.dateFrom) conditions.push(gte(transactionsTable.date, qp.data.dateFrom));
  if (qp.data.dateTo) conditions.push(lte(transactionsTable.date, qp.data.dateTo));
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db.select({
    date: transactionsTable.date,
    revenue: sql<string>`sum(${transactionsTable.spend})`,
    cost: sql<string>`sum(${transactionsTable.cost})`,
    profit: sql<string>`sum(${transactionsTable.profit})`,
  }).from(transactionsTable).where(whereClause).groupBy(transactionsTable.date).orderBy(transactionsTable.date);

  return NextResponse.json(GetProfitOverTimeResponse.parse(rows.map(r => ({
    date: r.date, revenue: parseFloat(r.revenue ?? "0"), cost: parseFloat(r.cost ?? "0"), profit: parseFloat(r.profit ?? "0"),
  }))));
}
