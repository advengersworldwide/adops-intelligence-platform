import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, usersTable, userBackupCodesTable } from "@workspace/db";
import { requireAuth, isAuthError } from "@/lib/auth/require";
import { generateBackupCodes, hashBackupCode } from "@/lib/auth/credentials";

export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, auth.user.sub));
  if (!user?.twoFactorEnabledAt) {
    return NextResponse.json({ error: "Two-factor authentication is not enabled" }, { status: 400 });
  }

  // Regenerating invalidates every previously issued code.
  await db.delete(userBackupCodesTable).where(eq(userBackupCodesTable.userId, user.id));
  const codes = generateBackupCodes();
  await db.insert(userBackupCodesTable).values(
    await Promise.all(codes.map(async (c) => ({ userId: user.id, codeHash: await hashBackupCode(c) }))),
  );

  return NextResponse.json({ backupCodes: codes });
}
