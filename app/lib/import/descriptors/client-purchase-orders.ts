// app/lib/import/descriptors/client-purchase-orders.ts
import type { ImportDescriptor, RowResult } from "../types";
import { normalizeName, parseDateCell, dedupKey } from "./cpo-helpers";
import { clientPurchaseOrdersColumns } from "./client-purchase-orders.columns";

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
  // Implemented in Task 6:
  async loadContext(): Promise<CpoContext> {
    throw new Error("not implemented");
  },
  resolveRow,
  async commit(): Promise<void> {
    throw new Error("not implemented");
  },
};
