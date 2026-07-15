// app/lib/import/descriptors/client-purchase-orders.ts
import type { ImportDescriptor, RowResult } from "../types";
import { normalizeName, parseDateCell, dedupKey } from "./cpo-helpers";
import { clientPurchaseOrdersColumns } from "./client-purchase-orders.columns";
import { db, clientsTable, clientPurchaseOrdersTable } from "@workspace/db";
import { formatPoCode } from "@/lib/po-codes";
import type { ImportSession } from "../types";
import { isoToLocalDate, mmyyKey, seedMaxSeq } from "./cpo-helpers";

export interface CpoContext {
  clientsByName: Map<string, Array<{ id: number; codePrefix: string }>>;
  existingKeys: Set<string>;
  maxSeqByGroup: Map<string, number>;
}

export interface CpoPayload {
  clientId: number;
  prefix: string;
  receiveDate: string | null;
  startDate: string | null;
  endDate: string | null;
}

// columns live in ./client-purchase-orders.columns (imported above)

function resolveRow(
  cells: Record<string, string>,
  rowNumber: number,
  ctx: CpoContext,
  seen: Set<string>,
): RowResult<CpoPayload> {
  const messages: string[] = [];
  const error = (msg: string): RowResult<CpoPayload> => ({ rowNumber, status: "error", messages: [msg] });

  const clientName = cells.clientName.trim();
  if (!clientName) return error("Client Name is required");

  const matches = ctx.clientsByName.get(normalizeName(clientName));
  if (!matches || matches.length === 0) return error(`Unknown client: "${clientName}"`);
  if (matches.length > 1) return error(`Ambiguous client name: "${clientName}" matches ${matches.length} clients`);
  const client = matches[0];
  const prefix = client.codePrefix.trim();
  if (!prefix) return error(`Client "${clientName}" has no PO code prefix — set one first`);

  const receiveDate = parseDateCell(cells.receiveDate, "Receive Date", messages);
  const startDate = parseDateCell(cells.startDate, "Start Date", messages);
  const endDate = parseDateCell(cells.endDate, "End Date", messages);
  if (messages.length) return { rowNumber, status: "error", messages };

  if (startDate && endDate && startDate > endDate) {
    return error("Start Date is after End Date");
  }

  const hasDates = Boolean(receiveDate || startDate || endDate);
  if (hasDates) {
    const key = dedupKey(client.id, receiveDate, startDate, endDate);
    if (ctx.existingKeys.has(key)) {
      return { rowNumber, status: "skip", messages: ["Duplicate of an existing PO for this client & dates"] };
    }
    if (seen.has(key)) {
      return { rowNumber, status: "skip", messages: ["Duplicate row in file"] };
    }
    seen.add(key);
  }

  return {
    rowNumber,
    status: "valid",
    messages: [],
    payload: { clientId: client.id, prefix, receiveDate, startDate, endDate },
  };
}

export const clientPurchaseOrdersDescriptor: ImportDescriptor<CpoContext, CpoPayload> = {
  type: "client-purchase-orders",
  label: "Client Purchase Orders",
  columns: clientPurchaseOrdersColumns,
  async loadContext(): Promise<CpoContext> {
    const clients = await db
      .select({ id: clientsTable.id, name: clientsTable.name, codePrefix: clientsTable.codePrefix })
      .from(clientsTable);

    const clientsByName = new Map<string, Array<{ id: number; codePrefix: string }>>();
    for (const c of clients) {
      const key = normalizeName(c.name);
      const list = clientsByName.get(key) ?? [];
      list.push({ id: c.id, codePrefix: c.codePrefix ?? "" });
      clientsByName.set(key, list);
    }

    const existing = await db
      .select({
        code: clientPurchaseOrdersTable.code,
        clientId: clientPurchaseOrdersTable.clientId,
        receiveDate: clientPurchaseOrdersTable.receiveDate,
        startDate: clientPurchaseOrdersTable.startDate,
        endDate: clientPurchaseOrdersTable.endDate,
      })
      .from(clientPurchaseOrdersTable);

    const existingKeys = new Set<string>();
    for (const r of existing) {
      existingKeys.add(dedupKey(r.clientId, r.receiveDate ?? null, r.startDate ?? null, r.endDate ?? null));
    }
    const maxSeqByGroup = seedMaxSeq(existing.map((r) => r.code));

    return { clientsByName, existingKeys, maxSeqByGroup };
  },
  resolveRow,
  async commit(payloads: CpoPayload[], ctx: CpoContext, session: ImportSession): Promise<void> {
    const counters = new Map(ctx.maxSeqByGroup);
    await db.transaction(async (tx) => {
      for (const p of payloads) {
        const date = p.receiveDate ? isoToLocalDate(p.receiveDate) : new Date();
        const group = `${p.prefix}|${mmyyKey(date)}`;
        const next = (counters.get(group) ?? 0) + 1;
        counters.set(group, next);
        const code = formatPoCode(p.prefix, date, next);
        await tx.insert(clientPurchaseOrdersTable).values({
          code,
          clientId: p.clientId,
          attachmentUrl: "",
          attachmentName: null,
          attachments: [],
          receiveDate: p.receiveDate,
          startDate: p.startDate,
          endDate: p.endDate,
          createdById: session.userId,
        });
      }
    });
  },
};
