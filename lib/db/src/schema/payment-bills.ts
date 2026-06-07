import { pgTable, serial, integer, numeric, unique } from "drizzle-orm/pg-core";
import { paymentsTable } from "./payments";
import { billsTable } from "./bills";

export const paymentBillsTable = pgTable("payment_bills", {
  id: serial("id").primaryKey(),
  paymentId: integer("payment_id").notNull().references(() => paymentsTable.id, { onDelete: "cascade" }),
  billId: integer("bill_id").notNull().references(() => billsTable.id, { onDelete: "cascade" }),
  amountApplied: numeric("amount_applied", { precision: 14, scale: 2 }).notNull(),
}, (t) => [unique().on(t.paymentId, t.billId)]);

export type PaymentBill = typeof paymentBillsTable.$inferSelect;
