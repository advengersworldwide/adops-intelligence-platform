import { eq } from "drizzle-orm";
import { db, dashboardLayoutsTable } from "@workspace/db";
import type { DashboardLayoutItem } from "@workspace/db";

export interface LayoutBody {
  activeWidgets: string[];
  layout: DashboardLayoutItem[];
  preset: string | null;
}

export async function getLayout(userId: number) {
  const [row] = await db.select().from(dashboardLayoutsTable).where(eq(dashboardLayoutsTable.userId, userId));
  return row ?? null;
}

export async function upsertLayout(userId: number, body: LayoutBody) {
  const [row] = await db
    .insert(dashboardLayoutsTable)
    .values({ userId, activeWidgets: body.activeWidgets, layout: body.layout, preset: body.preset })
    .onConflictDoUpdate({
      target: dashboardLayoutsTable.userId,
      set: { activeWidgets: body.activeWidgets, layout: body.layout, preset: body.preset },
    })
    .returning();
  return row;
}