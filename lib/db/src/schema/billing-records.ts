import { pgTable, serial, integer, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { partnersTable } from "./partners";
import { buyingHousesTable } from "./buying-houses";
import { costModelsTable } from "./cost-models";
import { clientsTable } from "./clients";

export const billingRecordsTable = pgTable("billing_records", {
  id: serial("id").primaryKey(),
  platformId: integer("platform_id")
    .notNull()
    .references(() => partnersTable.id, { onDelete: "cascade" }),
  buyingHouseId: integer("buying_house_id")
    .notNull()
    .references(() => buyingHousesTable.id),
  clientId: integer("client_id")
    .references(() => clientsTable.id, { onDelete: "set null" }),
  costModelId: integer("cost_model_id")
    .notNull()
    .references(() => costModelsTable.id),
  period: text("period").notNull(),
  pins: integer("pins").notNull(),
  fraudPins: integer("fraud_pins").notNull(),
  payoutRate: numeric("payout_rate", { precision: 12, scale: 4 }).notNull(),
  marginPct: numeric("margin_pct", { precision: 6, scale: 2 }).notNull(),
  forexSellingRate: numeric("forex_selling_rate", { precision: 10, scale: 4 }).notNull(),
  forexBuyingRate: numeric("forex_buying_rate", { precision: 10, scale: 4 }).notNull(),
  salesTaxPct: numeric("sales_tax_pct", { precision: 6, scale: 2 }).notNull(),
  remittanceTaxPct: numeric("remittance_tax_pct", { precision: 6, scale: 2 }).notNull(),
  withholdingTaxPct: numeric("withholding_tax_pct", { precision: 6, scale: 2 }).notNull(),
  bulkDiscountPct: numeric("bulk_discount_pct", { precision: 6, scale: 2 }).notNull(),
  platformBulkDiscountPct: numeric("platform_bulk_discount_pct", { precision: 6, scale: 2 }).notNull(),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BillingRecord = typeof billingRecordsTable.$inferSelect;
