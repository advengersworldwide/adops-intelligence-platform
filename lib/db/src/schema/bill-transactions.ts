import { pgTable, serial, integer, unique } from "drizzle-orm/pg-core";
import { billsTable } from "./bills";
import { billingRecordsTable } from "./billing-records";

export const billTransactionsTable = pgTable("bill_transactions", {
  id: serial("id").primaryKey(),
  billId: integer("bill_id").notNull().references(() => billsTable.id, { onDelete: "cascade" }),
  billingRecordId: integer("billing_record_id").notNull().references(() => billingRecordsTable.id, { onDelete: "cascade" }),
}, (t) => [unique().on(t.billId, t.billingRecordId)]);

export type BillTransaction = typeof billTransactionsTable.$inferSelect;
