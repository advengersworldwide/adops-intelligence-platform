import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";
import { buyingHousesTable } from "./buying-houses";
import { paymentTermsTable } from "./payment-terms";
import { kycColumns } from "./kyc-columns";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const clientsTable = pgTable("clients", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  codePrefix: text("code_prefix").notNull(),
  buyingHouseId: integer("buying_house_id")
    .references(() => buyingHousesTable.id, { onDelete: "set null" }),
  ...kycColumns,
  salesTaxPct: numeric("sales_tax_pct", { precision: 6, scale: 2 }),
  withholdingTaxPct: numeric("withholding_tax_pct", { precision: 6, scale: 2 }),
  paymentTermsId: integer("payment_terms_id")
    .references(() => paymentTermsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertClientSchema = createInsertSchema(clientsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertClient = z.infer<typeof insertClientSchema>;
export type Client = typeof clientsTable.$inferSelect;
