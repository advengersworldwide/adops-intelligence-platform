import { pgTable, serial, integer, text, timestamp, jsonb, date } from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";
import { usersTable } from "./auth";

export type PoAttachment = { url: string; name: string | null };

export const clientPurchaseOrdersTable = pgTable("client_purchase_orders", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "restrict" }),
  // Legacy single-attachment columns — kept populated with the first attachment
  // for backward compatibility. `attachments` is the source of truth.
  attachmentUrl: text("attachment_url").notNull(),
  attachmentName: text("attachment_name"),
  attachments: jsonb("attachments").$type<PoAttachment[]>().notNull().default([]),
  receiveDate: date("receive_date"),   // date the PO was received
  startDate: date("start_date"),       // campaign start (duration range)
  endDate: date("end_date"),           // campaign end (duration range)
  createdById: integer("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type ClientPurchaseOrder = typeof clientPurchaseOrdersTable.$inferSelect;
