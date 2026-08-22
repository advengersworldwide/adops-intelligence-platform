import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { requirePermission, isAuthError } from "@/lib/auth/require";
import { generateTempPassword } from "@/lib/auth/credentials";

export const runtime = "nodejs";

const BCRYPT_ROUNDS = 12;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await requirePermission("settings.users:manage");
  if (isAuthError(auth)) return auth;

  const { id } = await params;
  const userId = Number(id);
  if (!Number.isInteger(userId)) {
    return NextResponse.json({ error: "Invalid user id" }, { status: 400 });
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (user.isSystem) {
    return NextResponse.json({ error: "Cannot modify system accounts" }, { status: 400 });
  }

  // System-generated rather than admin-typed, so no account starts life as
  // "welcome123". Shown once and never stored in plaintext.
  const tempPassword = generateTempPassword();
  await db
    .update(usersTable)
    .set({
      password: await bcrypt.hash(tempPassword, BCRYPT_ROUNDS),
      mustChangePassword: true,
      passwordChangedAt: new Date(),
      tokenVersion: user.tokenVersion + 1,
    })
    .where(eq(usersTable.id, user.id));

  return NextResponse.json({ tempPassword, username: user.username });
}
