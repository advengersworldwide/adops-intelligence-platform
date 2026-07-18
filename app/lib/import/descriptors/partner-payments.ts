// app/lib/import/descriptors/partner-payments.ts
import type { FlatImportDescriptor, RowResult } from "../types";
import { parseDateCell } from "./cpo-helpers";
import { partnerPaymentsColumns } from "./partner-payments.columns";

export interface PpayContext {
  billByCode: Map<string, { id: number; partnerId: number; amount: number; remaining: number }>;
  existingDedupKeys: Set<string>;        // `${billId}|${amount}|${paymentDate}`
  batchAllocated: Map<number, number>;   // billId -> USD allocated by valid rows so far (mutated during a run)
}

export interface PpayPayload {
  partnerId: number;
  partnerBillId: number;
  amount: number;
  mode: string | null;
  status: string;
  paymentDate: string | null;
  notes: string | null;
}

const VALID_STATUS = new Set(["pending", "settled"]);

function dedupKey(billId: number, amount: number, paymentDate: string | null): string {
  return `${billId}|${amount}|${paymentDate ?? ""}`;
}

function resolveRow(
  cells: Record<string, string>,
  rowNumber: number,
  ctx: PpayContext,
  seen: Set<string>,
): RowResult<PpayPayload> {
  const messages: string[] = [];
  const error = (msg: string): RowResult<PpayPayload> => ({ rowNumber, status: "error", messages: [msg] });

  const billCode = cells.partnerBillCode.trim();
  if (!billCode) return error("Partner Bill Code is required");
  const bill = ctx.billByCode.get(billCode);
  if (!bill) return error(`Unknown partner bill code: "${billCode}"`);

  const amountStr = cells.amount.trim();
  const amount = Number(amountStr);
  if (!amountStr || !Number.isFinite(amount) || amount <= 0) return error(`Invalid amount "${cells.amount}"`);

  const status = (cells.status.trim() || "pending").toLowerCase();
  if (!VALID_STATUS.has(status)) return error(`Invalid status "${cells.status}" (expected pending or settled)`);

  const paymentDate = parseDateCell(cells.paymentDate, "Payment Date", messages);
  if (messages.length) return { rowNumber, status: "error", messages };

  // Dedup first, so a re-import of the same payment skips rather than erroring on over-allocation.
  const key = dedupKey(bill.id, amount, paymentDate);
  if (ctx.existingDedupKeys.has(key)) return { rowNumber, status: "skip", messages: ["Duplicate of an existing payment (same bill, amount & date)"] };
  if (seen.has(key)) return { rowNumber, status: "skip", messages: ["Duplicate payment in file (same bill, amount & date)"] };

  const available = bill.remaining - (ctx.batchAllocated.get(bill.id) ?? 0);
  if (amount > available + 0.01) {
    return error(`Amount ${amount} exceeds remaining ${available.toFixed(2)} on bill ${billCode}`);
  }

  ctx.batchAllocated.set(bill.id, (ctx.batchAllocated.get(bill.id) ?? 0) + amount);
  seen.add(key);
  return {
    rowNumber,
    status: "valid",
    messages: [],
    payload: {
      partnerId: bill.partnerId, partnerBillId: bill.id, amount,
      mode: cells.mode.trim() || null, status,
      paymentDate, notes: cells.notes.trim() || null,
    },
  };
}

export const partnerPaymentsDescriptor: FlatImportDescriptor<PpayContext, PpayPayload> = {
  type: "partner-payments",
  label: "Partner Payments",
  columns: partnerPaymentsColumns,
  // Implemented in Task 2:
  async loadContext(): Promise<PpayContext> {
    throw new Error("not implemented");
  },
  resolveRow,
  async commit(): Promise<void> {
    throw new Error("not implemented");
  },
};
