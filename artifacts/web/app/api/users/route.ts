import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { requireAdmin, isAuthError } from "@/lib/auth/require";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const auth = await requireAdmin();
  if (isAuthError(auth)) return auth;
  try {
    const rows = await db.select().from(usersTable).orderBy(usersTable.id);
    return NextResponse.json(rows.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role, isSystem: u.isSystem })));
  } catch {
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<Response> {
  const auth = await requireAdmin();
  if (isAuthError(auth)) return auth;
  try {
    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const { name, password, role } = body as Record<string, unknown>;
    const email = String((body as Record<string, unknown>).email ?? "").trim().toLowerCase();
    if (!name || !email || !role) return NextResponse.json({ error: "name, email, and role are required" }, { status: 400 });

    const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    if (existing) {
      if (existing.isSystem) return NextResponse.json({ error: "Cannot modify system accounts" }, { status: 400 });
      const updates: Record<string, unknown> = { name, role, updatedAt: new Date() };
      if (password) updates.password = await bcrypt.hash(String(password), 12);
      const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.email, email)).returning();
      return NextResponse.json({ id: updated.id, name: updated.name, email: updated.email, role: updated.role, isSystem: updated.isSystem });
    } else {
      if (!password) return NextResponse.json({ error: "Password is required for new users" }, { status: 400 });
      const hashed = await bcrypt.hash(String(password), 12);
      const [inserted] = await db.insert(usersTable).values({ name: String(name), email, password: hashed, role: String(role), isSystem: false }).returning();
      return NextResponse.json({ id: inserted.id, name: inserted.name, email: inserted.email, role: inserted.role, isSystem: inserted.isSystem }, { status: 201 });
    }
  } catch {
    return NextResponse.json({ error: "Failed to save user" }, { status: 500 });
  }
}
