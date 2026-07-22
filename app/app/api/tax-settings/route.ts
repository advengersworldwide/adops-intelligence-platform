import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, taxSettingsTable } from "@workspace/db";
import { UpdateTaxSettingsBody } from "@workspace/api-zod";
import { requireAuth, requirePermission, isAuthError } from "@/lib/auth/require";

export const runtime = "nodejs";

const DEFAULTS = { remittanceTaxPct: "15", salesTaxPct: "15", withholdingTaxPct: "7" };

async function getOrCreate() {
  const [row] = await db.select().from(taxSettingsTable).limit(1);
  if (row) return row;
  const [created] = await db.insert(taxSettingsTable).values(DEFAULTS).returning();
  return created;
}

function map(r: typeof taxSettingsTable.$inferSelect) {
  return {
    id: r.id,
    remittanceTaxPct: Number(r.remittanceTaxPct),
    salesTaxPct: Number(r.salesTaxPct),
    withholdingTaxPct: Number(r.withholdingTaxPct),
  };
}

// Read is broad: tax rates feed billing math surfaces; edited only from Settings › General.
export async function GET(): Promise<Response> {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  return NextResponse.json(map(await getOrCreate()));
}

export async function PUT(req: Request): Promise<Response> {
  const auth = await requirePermission("settings.general:view");
  if (isAuthError(auth)) return auth;
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = UpdateTaxSettingsBody.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  // Range validation — remittance must stay below 100 (it is a gross-up divisor: 1 - rate/100),
  // and all three are percentages in [0, 100].
  const { remittanceTaxPct, salesTaxPct, withholdingTaxPct } = parsed.data;
  const pctOk = (n: number, maxExclusive: boolean) =>
    n >= 0 && (maxExclusive ? n < 100 : n <= 100);
  if (!pctOk(remittanceTaxPct, true) || !pctOk(salesTaxPct, false) || !pctOk(withholdingTaxPct, false)) {
    return NextResponse.json(
      { error: "Tax percentages must be in range (remittance 0–99.99, sales/withholding 0–100)" },
      { status: 400 },
    );
  }

  const current = await getOrCreate();
  const [row] = await db.update(taxSettingsTable).set({
    remittanceTaxPct: String(remittanceTaxPct),
    salesTaxPct: String(salesTaxPct),
    withholdingTaxPct: String(withholdingTaxPct),
  }).where(eq(taxSettingsTable.id, current.id)).returning();
  return NextResponse.json(map(row));
}
