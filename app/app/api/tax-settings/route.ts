import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, taxSettingsTable } from "@workspace/db";
import { UpdateTaxSettingsBody } from "@workspace/api-zod";
import { requireAuth, requirePermission, isAuthError } from "@/lib/auth/require";

export const runtime = "nodejs";

const DEFAULTS = { remittanceTaxPct: "15", salesTaxPct: "15", withholdingTaxPct: "7", baseCurrency: "PKR" };

const SUPPORTED_CURRENCIES = new Set(["USD", "EUR", "GBP", "INR", "JPY", "CAD", "AUD", "PKR", "SAR", "AED"]);

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
    baseCurrency: r.baseCurrency,
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

  const current = await getOrCreate();

  // Merge provided fields over current (partial update).
  const remittanceTaxPct = parsed.data.remittanceTaxPct ?? Number(current.remittanceTaxPct);
  const salesTaxPct = parsed.data.salesTaxPct ?? Number(current.salesTaxPct);
  const withholdingTaxPct = parsed.data.withholdingTaxPct ?? Number(current.withholdingTaxPct);
  const baseCurrency = parsed.data.baseCurrency ?? current.baseCurrency;

  // Range validation — remittance is a gross-up divisor (1 - rate/100) so must stay < 100;
  // sales/withholding are percentages in [0, 100].
  const pctOk = (n: number, maxExclusive: boolean) =>
    n >= 0 && (maxExclusive ? n < 100 : n <= 100);
  if (!pctOk(remittanceTaxPct, true) || !pctOk(salesTaxPct, false) || !pctOk(withholdingTaxPct, false)) {
    return NextResponse.json(
      { error: "Tax percentages must be in range (remittance 0–99.99, sales/withholding 0–100)" },
      { status: 400 },
    );
  }
  if (!SUPPORTED_CURRENCIES.has(baseCurrency)) {
    return NextResponse.json({ error: `Unsupported base currency: ${baseCurrency}` }, { status: 400 });
  }

  const [row] = await db.update(taxSettingsTable).set({
    remittanceTaxPct: String(remittanceTaxPct),
    salesTaxPct: String(salesTaxPct),
    withholdingTaxPct: String(withholdingTaxPct),
    baseCurrency,
  }).where(eq(taxSettingsTable.id, current.id)).returning();
  return NextResponse.json(map(row));
}
