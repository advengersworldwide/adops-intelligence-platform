import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, usersTable, userBackupCodesTable } from "@workspace/db";
import { requirePermission, isAuthError } from "@/lib/auth/require";

export const runtime = "nodejs";

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

  // Clearing the secret forces re-enrolment at the next login for privileged
  // users, and simply disables 2FA for everyone else.
  await db.delete(userBackupCodesTable).where(eq(userBackupCodesTable.userId, user.id));
  await db
    .update(usersTable)
    .set({
      twoFactorSecret: null,
      twoFactorEnabledAt: null,
      lastTotpStep: null,
      twoFactorFailedAttempts: 0,
      twoFactorLockedUntil: null,
      tokenVersion: user.tokenVersion + 1,
    })
    .where(eq(usersTable.id, user.id));

  return NextResponse.json({ ok: true });
}
