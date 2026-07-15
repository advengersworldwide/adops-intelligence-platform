// app/lib/import/descriptors/partner-purchase-orders.ts
import type { GroupedImportDescriptor, RowResult } from "../types";
import { normalizeName, parseDateCell } from "./cpo-helpers";
import { partnerPurchaseOrdersColumns } from "./partner-purchase-orders.columns";

export interface PpoContext {
  partnersByName: Map<string, Array<{ id: number; codePrefix: string }>>;
  cpoByCode: Map<string, { id: number; clientId: number }>;
  eventsByClientAndName: Map<string, Array<{ id: number }>>; // key: `${clientId}|${normalizedName}`
  existingKeys: Set<string>;                                 // `${partnerId}|${cpoId}|${start}|${end}`
  maxSeqByGroup: Map<string, number>;
}

export interface PpoItem { clientEventId: number; eventName: string; cacRate: number; eventCount: number; }
export interface PpoPayload {
  partnerId: number;
  prefix: string;
  clientPurchaseOrderId: number;
  startDate: string;
  endDate: string;
  notes: string | null;
  items: PpoItem[];
}

type GroupRow = { cells: Record<string, string>; rowNumber: number };

/** The single non-empty value for a header field across the group, or "" (pushes a conflict error if >1). */
function pickHeader(groupRows: GroupRow[], key: string, label: string, errors: string[]): string {
  const values = new Set(groupRows.map((r) => (r.cells[key] ?? "").trim()).filter((v) => v !== ""));
  if (values.size > 1) { errors.push(`Conflicting ${label} within this PO reference`); return ""; }
  return values.size === 1 ? [...values][0] : "";
}

function resolveGroup(groupRows: GroupRow[], ctx: PpoContext, seen: Set<string>): RowResult<PpoPayload> {
  const rowNumber = groupRows[0].rowNumber;
  const ref = groupRows[0].cells.poReference;
  const messages: string[] = [];
  const error = (msg: string): RowResult<PpoPayload> => ({ rowNumber, status: "error", messages: [msg] });

  const partnerName = pickHeader(groupRows, "partnerName", "Partner", messages);
  const clientPoCode = pickHeader(groupRows, "clientPoCode", "Client PO Code", messages);
  const startRaw = pickHeader(groupRows, "startDate", "Start Date", messages);
  const endRaw = pickHeader(groupRows, "endDate", "End Date", messages);
  const notesRaw = pickHeader(groupRows, "notes", "Notes", messages);
  if (messages.length) return { rowNumber, status: "error", messages };

  if (!partnerName) return error(`Partner is required (PO reference "${ref}")`);
  const partnerMatches = ctx.partnersByName.get(normalizeName(partnerName));
  if (!partnerMatches || partnerMatches.length === 0) return error(`Unknown partner: "${partnerName}"`);
  if (partnerMatches.length > 1) return error(`Ambiguous partner name: "${partnerName}"`);
  const partner = partnerMatches[0];
  const prefix = partner.codePrefix.trim();
  if (!prefix) return error(`Partner "${partnerName}" has no PO code prefix — set one first`);

  if (!clientPoCode) return error(`Client PO Code is required (PO reference "${ref}")`);
  const cpo = ctx.cpoByCode.get(clientPoCode.trim());
  if (!cpo) return error(`Unknown client PO code: "${clientPoCode}"`);

  const startDate = parseDateCell(startRaw, "Start Date", messages);
  const endDate = parseDateCell(endRaw, "End Date", messages);
  if (messages.length) return { rowNumber, status: "error", messages };
  if (!startDate || !endDate) return error("Start Date and End Date are required");
  if (startDate > endDate) return error("Start Date is after End Date");

  const key = `${partner.id}|${cpo.id}|${startDate}|${endDate}`;
  if (ctx.existingKeys.has(key)) return { rowNumber, status: "skip", messages: ["Duplicate of an existing partner PO for this partner, client PO & dates"] };
  if (seen.has(key)) return { rowNumber, status: "skip", messages: ["Duplicate PO in file"] };

  const items: PpoItem[] = [];
  for (const gr of groupRows) {
    const eventName = (gr.cells.eventName ?? "").trim();
    if (!eventName) return { rowNumber: gr.rowNumber, status: "error", messages: [`Event is required (row ${gr.rowNumber})`] };
    const evMatches = ctx.eventsByClientAndName.get(`${cpo.clientId}|${normalizeName(eventName)}`);
    if (!evMatches || evMatches.length === 0) return { rowNumber: gr.rowNumber, status: "error", messages: [`Unknown event "${eventName}" for this client (row ${gr.rowNumber})`] };
    if (evMatches.length > 1) return { rowNumber: gr.rowNumber, status: "error", messages: [`Ambiguous event "${eventName}" for this client (row ${gr.rowNumber})`] };
    const cacStr = (gr.cells.cacRate ?? "").trim();
    const cacRate = Number(cacStr);
    if (!cacStr || Number.isNaN(cacRate) || cacRate < 0) return { rowNumber: gr.rowNumber, status: "error", messages: [`Invalid CAC Rate "${gr.cells.cacRate}" (row ${gr.rowNumber})`] };
    const countStr = (gr.cells.eventCount ?? "").trim();
    const eventCount = Number(countStr);
    if (!countStr || !Number.isInteger(eventCount) || eventCount < 0) return { rowNumber: gr.rowNumber, status: "error", messages: [`Invalid Event Count "${gr.cells.eventCount}" (row ${gr.rowNumber})`] };
    items.push({ clientEventId: evMatches[0].id, eventName, cacRate, eventCount });
  }
  if (items.length === 0) return error("PO has no line items");

  seen.add(key);
  return {
    rowNumber,
    status: "valid",
    messages: [],
    payload: { partnerId: partner.id, prefix, clientPurchaseOrderId: cpo.id, startDate, endDate, notes: notesRaw || null, items },
  };
}

export const partnerPurchaseOrdersDescriptor: GroupedImportDescriptor<PpoContext, PpoPayload> = {
  type: "partner-purchase-orders",
  label: "Partner Purchase Orders",
  columns: partnerPurchaseOrdersColumns,
  groupBy: "poReference",
  // Implemented in Task 4:
  async loadContext(): Promise<PpoContext> {
    throw new Error("not implemented");
  },
  resolveGroup,
  async commit(): Promise<void> {
    throw new Error("not implemented");
  },
};