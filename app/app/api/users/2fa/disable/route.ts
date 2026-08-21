import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, usersTable, userBackupCodesTable } from "@workspace/db";
import { requireAuth, isAuthError } from "@/lib/auth/require";
import { verifyTotp } from "@/lib/auth/totp";
import { tryDecryptSecret } from "@/lib/auth/secret-crypto";
import { isPrivileged } from "@/lib/auth/next-step";
import { getRolePermissions } from "@/lib/rbac/role-permissions";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const auth = await requireAuth();
  if (isAuthError(auth)) return auth;

  let body: { password?: unknown; code?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, auth.user.sub));
  if (!user || !user.twoFactorEnabledAt || !user.twoFactorSecret) {
    return NextResponse.json({ error: "Two-factor authentication is not enabled" }, { status: 400 });
  }

  const rolePerms = await getRolePermissions(user.role);
  if (isPrivileged(user.role, user.isSystem, rolePerms)) {
    return NextResponse.json(
      { error: "Two-factor authentication is required for administrator accounts and cannot be disabled." },
      { status: 403 },
    );
  }

  // Re-authenticate with both factors before removing one of them.
  const passwordOk = await bcrypt.compare(String(body.password ?? ""), user.password);
  const secret = tryDecryptSecret(user.twoFactorSecret, "2fa/disable");
  const codeOk = secret ? verifyTotp(secret, String(body.code ?? ""), null).valid : false;
  if (!passwordOk || !codeOk) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

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
