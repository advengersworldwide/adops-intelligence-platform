import { pgTable, serial, integer, text, numeric, timestamp } from "drizzle-orm/pg-core";
import { platformsTable } from "./platforms";
import { buyingHousesTable } from "./buying-houses";
import { platformCostModelsTable } from "./platform-cost-models";

export const billingRecordsTable = pgTable("billing_records", {
  id: serial("id").primaryKey(),
  platformId: integer("platform_id")
    .notNull()
    .references(() => platformsTable.id, { onDelete: "cascade" }),
  buyingHouseId: integer("buying_house_id")
    .notNull()
    .references(() => buyingHousesTable.id),
  costModelId: integer("cost_model_id")
    .notNull()
    .references(() => platformCostModelsTable.id),
  period: text("period").notNull(),
  appsflyerPins: integer("appsflyer_pins").notNull(),
  fraudPins: integer("fraud_pins").notNull(),
  payoutRate: numeric("payout_rate", { precision: 12, scale: 4 }).notNull(),
  marginPct: numeric("margin_pct", { precision: 6, scale: 2 }).notNull(),
  forexRate: numeric("forex_rate", { precision: 10, scale: 4 }).notNull(),
  salesTaxPct: numeric("sales_tax_pct", { precision: 6, scale: 2 }).notNull(),
  remittanceTaxPct: numeric("remittance_tax_pct", { precision: 6, scale: 2 }).notNull(),
  withholdingTaxPct: numeric("withholding_tax_pct", { precision: 6, scale: 2 }).notNull(),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BillingRecord = typeof billingRecordsTable.$inferSelect;
