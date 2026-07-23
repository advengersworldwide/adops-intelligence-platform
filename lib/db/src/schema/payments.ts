import { pgTable, serial, text, numeric, date, timestamp } from "drizzle-orm/pg-core";

export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  referenceCode: text("reference_code").unique(), // CPMT-MMYY-NNNN, auto-generated
  mode: text("mode").notNull(),
  status: text("status").notNull().default("pending"),
  paymentDate: date("payment_date"),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull(),
  notes: text("notes"),
  chequeImageUrl: text("cheque_image_url"),
  receiptUrl: text("receipt_url"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Payment = typeof paymentsTable.$inferSelect;
