import { pgTable, serial, integer, text, numeric, date, timestamp } from "drizzle-orm/pg-core";
import { partnersTable } from "./partners";
import { partnerBillsTable } from "./partner-bills";
import { paymentsTable } from "./payments";
import { usersTable } from "./auth";

export const partnerPaymentsTable = pgTable("partner_payments", {
  id: serial("id").primaryKey(),
  referenceCode: text("reference_code").unique(), // PPMT-MMYY-NNNN, auto-generated
  partnerId: integer("partner_id").notNull().references(() => partnersTable.id, { onDelete: "restrict" }),
  partnerBillId: integer("partner_bill_id").notNull().references(() => partnerBillsTable.id, { onDelete: "cascade" }),
  sourceClientPaymentId: integer("source_client_payment_id").references(() => paymentsTable.id, { onDelete: "set null" }),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),        // USD
  mode: text("mode"),
  status: text("status").notNull().default("pending"),                     // pending | settled
  attachmentUrl: text("attachment_url"),
  paymentDate: date("payment_date"),
  notes: text("notes"),
  createdById: integer("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PartnerPayment = typeof partnerPaymentsTable.$inferSelect;
