import { pgTable, serial, integer, text, numeric, boolean, timestamp } from "drizzle-orm/pg-core";
import { clientsTable } from "./clients";
import { clientPurchaseOrdersTable } from "./client-purchase-orders";
import { usersTable } from "./auth";

export const billingsTable = pgTable("billings", {
  id: serial("id").primaryKey(),
  clientId: integer("client_id").notNull().references(() => clientsTable.id, { onDelete: "restrict" }),
  clientPurchaseOrderId: integer("client_purchase_order_id").notNull()
    .references(() => clientPurchaseOrdersTable.id, { onDelete: "restrict" }),
  period: text("period").notNull(), // YYYY-MM, from the CPO
  forexSellingRate: numeric("forex_selling_rate", { precision: 10, scale: 4 }).notNull(),
  forexBuyingRate: numeric("forex_buying_rate", { precision: 10, scale: 4 }).notNull(),
  bulkDiscountPct: numeric("bulk_discount_pct", { precision: 6, scale: 2 }).notNull(),
  whtApplied: boolean("wht_applied").notNull().default(false),
  // Snapshot of global tax rates at creation time
  remittanceTaxPct: numeric("remittance_tax_pct", { precision: 6, scale: 2 }).notNull(),
  salesTaxPct: numeric("sales_tax_pct", { precision: 6, scale: 2 }).notNull(),
  withholdingTaxPct: numeric("withholding_tax_pct", { precision: 6, scale: 2 }).notNull(),
  status: text("status").notNull().default("pending"), // pending | approved | dispute
  invoiceCode: text("invoice_code").unique(),
  invoiceGeneratedAt: timestamp("invoice_generated_at", { withTimezone: true }),
  notes: text("notes"),
  createdById: integer("created_by_id").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Billing = typeof billingsTable.$inferSelect;