import { pgTable, serial, integer, jsonb, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export type DashboardLayoutItem = {
  i: string; x: number; y: number; w: number; h: number; minW?: number; minH?: number;
};

// One row per user. Holds the user's dashboard grid + active widget set.
export const dashboardLayoutsTable = pgTable("dashboard_layouts", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id).unique(),
  activeWidgets: jsonb("active_widgets").$type<string[]>().notNull(),
  layout: jsonb("layout").$type<DashboardLayoutItem[]>().notNull(),
  preset: text("preset"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type DashboardLayoutRow = typeof dashboardLayoutsTable.$inferSelect;