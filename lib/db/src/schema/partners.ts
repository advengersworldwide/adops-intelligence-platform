import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { kycColumns } from "./kyc-columns";
import { paymentTermsTable } from "./payment-terms";

export const partnersTable = pgTable("partners", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  ...kycColumns,
  paymentTermsId: integer("payment_terms_id")
    .references(() => paymentTermsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Partner = typeof partnersTable.$inferSelect;
