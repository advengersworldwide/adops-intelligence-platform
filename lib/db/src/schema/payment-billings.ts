import { pgTable, serial, integer, numeric, unique } from "drizzle-orm/pg-core";
import { paymentsTable } from "./payments";
import { billingsTable } from "./billings";

export const paymentBillingsTable = pgTable("payment_billings", {
  id: serial("id").primaryKey(),
  paymentId: integer("payment_id").notNull().references(() => paymentsTable.id, { onDelete: "cascade" }),
  billingId: integer("billing_id").notNull().references(() => billingsTable.id, { onDelete: "cascade" }),
  amountApplied: numeric("amount_applied", { precision: 14, scale: 2 }).notNull(),
}, (t) => ({ uniqPaymentBilling: unique().on(t.paymentId, t.billingId) }));

export type PaymentBilling = typeof paymentBillingsTable.$inferSelect;
