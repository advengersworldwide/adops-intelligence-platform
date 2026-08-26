// app/lib/import/descriptors/client-billing-summary.ts
import { eq } from "drizzle-orm";
import type { FlatImportDescriptor, ImportScope, ImportSession, RowResult } from "../types";
import { normalizeName } from "./cpo-helpers";
import { clientBillingSummaryColumns } from "./client-billing-summary.columns";
import { db, billingRecordsTable, partnersTable, clientsTable, buyingHousesTable, costModelsTable, taxSettingsTable } from "@workspace/db";

const PERIOD_RE = /^\d{4}-\d{2}$/;

interface Ctx {
  client: { id: number; name: string; buyingHouseId: number | null; bulkDiscountPct: number } | null;
  partnersByName: Map<string, Array<{ id: number; platformBulkDiscountPct: number }>>;
  costModelsByName: Map<string, Array<{ id: number }>>;
  tax: { salesTaxPct: number; remittanceTaxPct: number; withholdingTaxPct: number };
  existingKeys: Set<string>; // `${clientId}|${partnerId}|${period}`
}

interface Payload {
  platformId: number;
  buyingHouseId: number;
  clientId: number;
  costModelId: number;
  period: string;
  pins: number;
  fraudPins: number;
  payoutRate: number;
  marginPct: number;
  forexSellingRate: number;
  forexBuyingRate: number;
  salesTaxPct: number;
  remittanceTaxPct: number;
  withholdingTaxPct: number;
  bulkDiscountPct: number;
  platformBulkDiscountPct: number;
}

/** Parse a numeric cell; on failure pushes a labelled message and returns 0. */
function num(value: string, label: string, errors: string[], opts: { int?: boolean; min?: number } = {}): number {
  const v = value.trim();
  const n = Number(v);
  if (v === "" || !Number.isFinite(n)) { errors.push(`${label} must be a number (got "${value}")`); return 0; }
  if (opts.int && !Number.isInteger(n)) { errors.push(`${label} must be a whole number (got "${value}")`); return 0; }
  if (opts.min != null && n < opts.min) { errors.push(`${label} must be ≥ ${opts.min}`); return 0; }
  return n;
}

function resolveRow(cells: Record<string, string>, rowNumber: number, ctx: Ctx, seen: Set<string>): RowResult<Payload> {
  const error = (msg: string): RowResult<Payload> => ({ rowNumber, status: "error", messages: [msg] });

  if (!ctx.client) return error("Select a client before uploading.");
  const buyingHouseId = ctx.client.buyingHouseId;
  if (buyingHouseId == null) return error(`The selected client "${ctx.client.name}" has no buying house set.`);

  const clientCell = cells.clientName.trim();
  if (!clientCell) return error("Client is required");
  if (normalizeName(clientCell) !== normalizeName(ctx.client.name)) {
    return error(`Row client "${clientCell}" does not match the selected client "${ctx.client.name}"`);
  }

  const partnerName = cells.partnerName.trim();
  if (!partnerName) return error("Partner is required");
  const pm = ctx.partnersByName.get(normalizeName(partnerName));
  if (!pm || pm.length === 0) return error(`Unknown partner: "${partnerName}"`);
  if (pm.length > 1) return error(`Ambiguous partner name: "${partnerName}"`);
  const partner = pm[0];

  const cmName = cells.costModel.trim();
  if (!cmName) return error("Cost Model is required");
  const cm = ctx.costModelsByName.get(normalizeName(cmName));
  if (!cm || cm.length === 0) return error(`Unknown cost model: "${cmName}"`);
  if (cm.length > 1) return error(`Ambiguous cost model: "${cmName}"`);

  const period = cells.period.trim();
  if (!PERIOD_RE.test(period)) return error(`Period must be YYYY-MM (got "${cells.period}")`);

  const errors: string[] = [];
  const pins = num(cells.pins, "PINs", errors, { int: true, min: 0 });
  const fraudPins = num(cells.fraudPins, "Fraud PINs", errors, { int: true, min: 0 });
  const payoutRate = num(cells.payoutRate, "Payout Rate", errors, { min: 0 });
  const marginPct = num(cells.marginPct, "Margin %", errors);
  const forexSellingRate = num(cells.forexSellingRate, "Forex Selling", errors, { min: 0 });
  const forexBuyingRate = num(cells.forexBuyingRate, "Forex Buying", errors, { min: 0 });
  if (errors.length) return { rowNumber, status: "error", messages: errors };

  const key = `${ctx.client.id}|${partner.id}|${period}`;
  if (ctx.existingKeys.has(key)) return { rowNumber, status: "skip", messages: ["Duplicate of an existing record (same client, partner & period)"] };
  if (seen.has(key)) return { rowNumber, status: "skip", messages: ["Duplicate row in file (same client, partner & period)"] };
  seen.add(key);

  return {
    rowNumber, status: "valid", messages: [],
    payload: {
      platformId: partner.id, buyingHouseId, clientId: ctx.client.id, costModelId: cm[0].id, period,
      pins, fraudPins, payoutRate, marginPct, forexSellingRate, forexBuyingRate,
      salesTaxPct: ctx.tax.salesTaxPct, remittanceTaxPct: ctx.tax.remittanceTaxPct, withholdingTaxPct: ctx.tax.withholdingTaxPct,
      bulkDiscountPct: ctx.client.bulkDiscountPct, platformBulkDiscountPct: partner.platformBulkDiscountPct,
    },
  };
}

export const clientBillingSummaryDescriptor: FlatImportDescriptor<Ctx, Payload> = {
  type: "client-billing-summary",
  label: "Client Billing Summary",
  columns: clientBillingSummaryColumns,
  async loadContext(scope: ImportScope): Promise<Ctx> {
    let client: Ctx["client"] = null;
    if (scope.clientId != null) {
      const [c] = await db
        .select({ id: clientsTable.id, name: clientsTable.name, buyingHouseId: clientsTable.buyingHouseId })
        .from(clientsTable).where(eq(clientsTable.id, scope.clientId));
      let bulkDiscountPct = 0;
      if (c?.buyingHouseId != null) {
        const [bh] = await db.select({ bulkDiscountPct: buyingHousesTable.bulkDiscountPct }).from(buyingHousesTable).where(eq(buyingHousesTable.id, c.buyingHouseId));
        if (bh?.bulkDiscountPct != null) bulkDiscountPct = Number(bh.bulkDiscountPct);
      }
      if (c) client = { id: c.id, name: c.name, buyingHouseId: c.buyingHouseId ?? null, bulkDiscountPct };
    }


    const partners = await db.select({ id: partnersTable.id, name: partnersTable.name, disc: partnersTable.platformBulkDiscountPct }).from(partnersTable);
    const partnersByName = new Map<string, Array<{ id: number; platformBulkDiscountPct: number }>>();
    for (const p of partners) {
      const k = normalizeName(p.name);
      const list = partnersByName.get(k) ?? [];
      list.push({ id: p.id, platformBulkDiscountPct: p.disc != null ? Number(p.disc) : 0 });
      partnersByName.set(k, list);
    }

    const cms = await db.select({ id: costModelsTable.id, name: costModelsTable.name }).from(costModelsTable);
    const costModelsByName = new Map<string, Array<{ id: number }>>();
    for (const c of cms) {
      const k = normalizeName(c.name);
      const list = costModelsByName.get(k) ?? [];
      list.push({ id: c.id });
      costModelsByName.set(k, list);
    }

    const [tax] = await db.select().from(taxSettingsTable).limit(1);
    const t = {
      salesTaxPct: tax ? Number(tax.salesTaxPct) : 0,
      remittanceTaxPct: tax ? Number(tax.remittanceTaxPct) : 0,
      withholdingTaxPct: tax ? Number(tax.withholdingTaxPct) : 0,
    };

    const existing = await db.select({ clientId: billingRecordsTable.clientId, platformId: billingRecordsTable.platformId, period: billingRecordsTable.period }).from(billingRecordsTable);
    const existingKeys = new Set<string>();
    for (const r of existing) {
      if (r.clientId != null) existingKeys.add(`${r.clientId}|${r.platformId}|${r.period}`);
    }

    return { client, partnersByName, costModelsByName, tax: t, existingKeys };
  },
  resolveRow,
  async commit(payloads: Payload[], _ctx: Ctx, session: ImportSession): Promise<void> {
    await db.transaction(async (tx) => {
      for (const p of payloads) {
        await tx.insert(billingRecordsTable).values({
          platformId: p.platformId, buyingHouseId: p.buyingHouseId, clientId: p.clientId, costModelId: p.costModelId,
          period: p.period, pins: p.pins, fraudPins: p.fraudPins,
          payoutRate: String(p.payoutRate), marginPct: String(p.marginPct),
          forexSellingRate: String(p.forexSellingRate), forexBuyingRate: String(p.forexBuyingRate),
          salesTaxPct: String(p.salesTaxPct), remittanceTaxPct: String(p.remittanceTaxPct), withholdingTaxPct: String(p.withholdingTaxPct),
          bulkDiscountPct: String(p.bulkDiscountPct), platformBulkDiscountPct: String(p.platformBulkDiscountPct),
          createdBy: session.userId != null ? String(session.userId) : null,
        });
      }
    });
  },
};
