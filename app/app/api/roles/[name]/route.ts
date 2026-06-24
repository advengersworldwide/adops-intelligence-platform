import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, rolesTable } from "@workspace/db";
import { requireAdmin, isAuthError } from "@/lib/auth/require";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ name: string }> },
): Promise<Response> {
  const auth = await requireAdmin();
  if (isAuthError(auth)) return auth;
  try {
    const { name } = await params;
    const [existing] = await db.select().from(rolesTable).where(eq(rolesTable.name, name));
    if (!existing) return NextResponse.json({ error: "Role not found" }, { status: 404 });
    if (existing.isSystem) return NextResponse.json({ error: "Cannot delete system roles" }, { status: 400 });
    await db.delete(rolesTable).where(eq(rolesTable.name, name));
    return new Response(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "Failed to delete role" }, { status: 500 });
  }
}
