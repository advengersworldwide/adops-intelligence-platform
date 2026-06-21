import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { requireAdmin, isAuthError } from "@/lib/auth/require";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ email: string }> },
): Promise<Response> {
  const auth = await requireAdmin();
  if (isAuthError(auth)) return auth;
  try {
    const { email: rawEmail } = await params;
    const email = decodeURIComponent(rawEmail).trim().toLowerCase();
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    if (!existing) return NextResponse.json({ error: "User not found" }, { status: 404 });
    if (existing.isSystem) return NextResponse.json({ error: "Cannot delete system accounts" }, { status: 400 });
    await db.delete(usersTable).where(eq(usersTable.email, email));
    return new Response(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "Failed to delete user" }, { status: 500 });
  }
}
