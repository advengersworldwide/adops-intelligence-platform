import { pgTable, serial, integer, text, numeric, date, timestamp } from "drizzle-orm/pg-core";
import { partnersTable } from "./partners";
import { clientsTable } from "./clients";
import { partnerPurchaseOrdersTable } from "./partner-purchase-orders";
import { usersTable } from "./auth";

export const partnerBillsTable = pgTable("partner_bills", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(), // PBILL-{partnerPrefix}-MMYY-NNNN
  partnerInvoiceNumber: text("partner_invoice_number"), // the partner's own number
  partnerId: integer("partner_id").notNull().references(() => partnersTable.id, { onDelete: "restrict" }),
  clientId: integer("client_id").references(() => clientsTable.id, { onDelete: "set null" }),
  partnerPurchaseOrderId: integer("partner_purchase_order_id")
    .references(() => partnerPurchaseOrdersTable.id, { onDelete: "set null" }),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(), // USD
  attachmentUrl: text("attachment_url"),
  attachmentName: text("attachment_name"),
  dateReceived: date("date_received"),
  notes: text("notes"),
  createdById: integer("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type PartnerBill = typeof partnerBillsTable.$inferSelect;
