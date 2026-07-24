import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { kycColumns } from "./kyc-columns";

export const buyingHousesTable = pgTable("buying_houses", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  ...kycColumns,
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BuyingHouse = typeof buyingHousesTable.$inferSelect;
