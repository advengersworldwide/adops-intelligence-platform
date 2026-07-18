// app/lib/import/descriptors/partner-bills.ts
import type { FlatImportDescriptor, RowResult } from "../types";
import { normalizeName, parseDateCell } from "./cpo-helpers";
import { partnerBillsColumns } from "./partner-bills.columns";
import { db, partnerBillsTable, partnersTable, clientsTable, partnerPurchaseOrdersTable } from "@workspace/db";
import { formatPoCode } from "@/lib/po-codes";
import type { ImportSession } from "../types";
import { isoToLocalDate, mmyyKey } from "./cpo-helpers";
import { seedMaxSeq } from "../po-code-seq";

export interface PbillContext {
  partnersByName: Map<string, Array<{ id: number; codePrefix: string }>>;
  clientsByName: Map<string, Array<{ id: number }>>;
  ppoByCode: Map<string, { id: number }>;
  existingKeys: Set<string>;      // `${partnerId}|${normalizedInvoiceNumber}`
  maxSeqByGroup: Map<string, number>;
}

export interface PbillPayload {
  partnerId: number;
  prefix: string;
  partnerInvoiceNumber: string | null;
  clientId: number | null;
  partnerPurchaseOrderId: number | null;
  amount: number;
  dateReceived: string | null;
  notes: string | null;
}

function resolveRow(
  cells: Record<string, string>,
  rowNumber: number,
  ctx: PbillContext,
  seen: Set<string>,
): RowResult<PbillPayload> {
  const messages: string[] = [];
  const error = (msg: string): RowResult<PbillPayload> => ({ rowNumber, status: "error", messages: [msg] });

  const partnerName = cells.partnerName.trim();
  if (!partnerName) return error("Partner is required");
  const pm = ctx.partnersByName.get(normalizeName(partnerName));
  if (!pm || pm.length === 0) return error(`Unknown partner: "${partnerName}"`);
  if (pm.length > 1) return error(`Ambiguous partner name: "${partnerName}"`);
  const partner = pm[0];
  const prefix = partner.codePrefix.trim();
  if (!prefix) return error(`Partner "${partnerName}" has no code prefix — set one first`);

  const amountStr = cells.amount.trim();
  const amount = Number(amountStr);
  if (!amountStr || !Number.isFinite(amount) || amount < 0) return error(`Invalid amount "${cells.amount}"`);

  let clientId: number | null = null;
  const clientName = cells.clientName.trim();
  if (clientName) {
    const cm = ctx.clientsByName.get(normalizeName(clientName));
    if (!cm || cm.length === 0) return error(`Unknown client: "${clientName}"`);
    if (cm.length > 1) return error(`Ambiguous client name: "${clientName}"`);
    clientId = cm[0].id;
  }

  let partnerPurchaseOrderId: number | null = null;
  const ppoCode = cells.partnerPoCode.trim();
  if (ppoCode) {
    const ppo = ctx.ppoByCode.get(ppoCode);
    if (!ppo) return error(`Unknown partner PO code: "${ppoCode}"`);
    partnerPurchaseOrderId = ppo.id;
  }

  const dateReceived = parseDateCell(cells.dateReceived, "Date Received", messages);
  if (messages.length) return { rowNumber, status: "error", messages };

  const invoice = cells.partnerInvoiceNumber.trim();
  if (invoice) {
    const key = `${partner.id}|${normalizeName(invoice)}`;
    if (ctx.existingKeys.has(key)) return { rowNumber, status: "skip", messages: ["Duplicate of an existing partner bill (same partner & invoice number)"] };
    if (seen.has(key)) return { rowNumber, status: "skip", messages: ["Duplicate bill in file (same partner & invoice number)"] };
    seen.add(key);
  }

  return {
    rowNumber,
    status: "valid",
    messages: [],
    payload: {
      partnerId: partner.id, prefix,
      partnerInvoiceNumber: invoice || null,
      clientId, partnerPurchaseOrderId, amount,
      dateReceived, notes: cells.notes.trim() || null,
    },
  };
}

export const partnerBillsDescriptor: FlatImportDescriptor<PbillContext, PbillPayload> = {
  type: "partner-bills",
  label: "Partner Bills",
  columns: partnerBillsColumns,
  async loadContext(): Promise<PbillContext> {
    const partners = await db
      .select({ id: partnersTable.id, name: partnersTable.name, codePrefix: partnersTable.codePrefix })
      .from(partnersTable);
    const partnersByName = new Map<string, Array<{ id: number; codePrefix: string }>>();
    for (const p of partners) {
      const k = normalizeName(p.name);
      const list = partnersByName.get(k) ?? [];
      list.push({ id: p.id, codePrefix: p.codePrefix ?? "" });
      partnersByName.set(k, list);
    }

    const clients = await db.select({ id: clientsTable.id, name: clientsTable.name }).from(clientsTable);
    const clientsByName = new Map<string, Array<{ id: number }>>();
    for (const c of clients) {
      const k = normalizeName(c.name);
      const list = clientsByName.get(k) ?? [];
      list.push({ id: c.id });
      clientsByName.set(k, list);
    }

    const ppos = await db.select({ id: partnerPurchaseOrdersTable.id, code: partnerPurchaseOrdersTable.code }).from(partnerPurchaseOrdersTable);
    const ppoByCode = new Map<string, { id: number }>();
    for (const p of ppos) ppoByCode.set(p.code, { id: p.id });

    const existing = await db
      .select({ partnerId: partnerBillsTable.partnerId, partnerInvoiceNumber: partnerBillsTable.partnerInvoiceNumber, code: partnerBillsTable.code })
      .from(partnerBillsTable);
    const existingKeys = new Set<string>();
    for (const r of existing) {
      if (r.partnerInvoiceNumber) existingKeys.add(`${r.partnerId}|${normalizeName(r.partnerInvoiceNumber)}`);
    }
    const maxSeqByGroup = seedMaxSeq(existing.map((r) => r.code), "PBILL");

    return { partnersByName, clientsByName, ppoByCode, existingKeys, maxSeqByGroup };
  },
  resolveRow,
  async commit(payloads: PbillPayload[], ctx: PbillContext, session: ImportSession): Promise<void> {
    const counters = new Map(ctx.maxSeqByGroup);
    await db.transaction(async (tx) => {
      for (const p of payloads) {
        const date = p.dateReceived ? isoToLocalDate(p.dateReceived) : new Date();
        const group = `${p.prefix}|${mmyyKey(date)}`;
        const next = (counters.get(group) ?? 0) + 1;
        counters.set(group, next);
        const code = "PBILL-" + formatPoCode(p.prefix, date, next);
        await tx.insert(partnerBillsTable).values({
          code,
          partnerInvoiceNumber: p.partnerInvoiceNumber,
          partnerId: p.partnerId,
          clientId: p.clientId,
          partnerPurchaseOrderId: p.partnerPurchaseOrderId,
          amount: String(p.amount),
          attachmentUrl: null,
          attachmentName: null,
          dateReceived: p.dateReceived,
          notes: p.notes,
          createdById: session.userId,
        });
      }
    });
  },
};