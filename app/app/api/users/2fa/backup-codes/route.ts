import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, usersTable, userBackupCodesTable } from "@workspace/db";
import { requireAuth, isAuthError } from "@/lib/auth/require";
import { generateBackupCodes, hashBackupCode } from "@/lib/auth/credentials";

export const runtime = "nodejs";
// Regeneration hashes ten new backup codes — bulk bcrypt work.
export const maxDuration = 30;

export async function POST(): Promise<Response> {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, auth.user.sub));
  if (!user?.twoFactorEnabledAt) {
    return NextResponse.json({ error: "Two-factor authentication is not enabled" }, { status: 400 });
  }

  // Regenerating invalidates every previously issued code. Delete and insert
  // run in one transaction, the same as reset-2fa: a failure between them
  // would otherwise leave a 2FA-enabled user with zero recovery codes.
  const codes = generateBackupCodes();
  const rows = await Promise.all(
    codes.map(async (c) => ({ userId: user.id, codeHash: await hashBackupCode(c) })),
  );
  await db.transaction(async (tx) => {
    await tx.delete(userBackupCodesTable).where(eq(userBackupCodesTable.userId, user.id));
    await tx.insert(userBackupCodesTable).values(rows);
  });

  return NextResponse.json({ backupCodes: codes });
}
