import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, rolesTable } from "@workspace/db";
import { requireAuth, requireAdmin, isAuthError } from "@/lib/auth/require";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;
  try {
    const rows = await db.select().from(rolesTable).orderBy(rolesTable.id);
    return NextResponse.json(rows.map(r => ({ name: r.name, permissions: r.permissions, isSystem: r.isSystem })));
  } catch {
    return NextResponse.json({ error: "Failed to fetch roles" }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<Response> {
  const auth = await requireAdmin();
  if (isAuthError(auth)) return auth;
  try {
    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const { name, permissions } = body as Record<string, unknown>;
    if (!name) return NextResponse.json({ error: "Role name is required" }, { status: 400 });
    if (!Array.isArray(permissions)) return NextResponse.json({ error: "Permissions must be an array" }, { status: 400 });
    const roleName = String(name);
    const [existing] = await db.select().from(rolesTable).where(eq(rolesTable.name, roleName));
    if (existing) {
      if (existing.isSystem) return NextResponse.json({ error: "Cannot modify system roles" }, { status: 400 });
      const [updated] = await db.update(rolesTable)
        .set({ permissions, updatedAt: new Date() })
        .where(eq(rolesTable.name, roleName))
        .returning();
      return NextResponse.json({ name: updated.name, permissions: updated.permissions, isSystem: updated.isSystem });
    } else {
      const [inserted] = await db.insert(rolesTable).values({ name: roleName, permissions, isSystem: false }).returning();
      return NextResponse.json({ name: inserted.name, permissions: inserted.permissions, isSystem: inserted.isSystem }, { status: 201 });
    }
  } catch {
    return NextResponse.json({ error: "Failed to save role" }, { status: 500 });
  }
}
