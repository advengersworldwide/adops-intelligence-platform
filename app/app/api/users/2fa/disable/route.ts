import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, usersTable, userBackupCodesTable } from "@workspace/db";
import { getSession } from "@/lib/auth/session";
import { verifyTotp } from "@/lib/auth/totp";
import { decryptSecret } from "@/lib/auth/secret-crypto";
import { isPrivileged } from "@/lib/auth/next-step";
import { getRolePermissions } from "@/lib/rbac/role-permissions";

export const runtime = "nodejs";

/**
 * `decryptSecret` throws when the AES-GCM auth tag fails to verify — e.g. if
 * TOTP_ENCRYPTION_KEY was rotated since this user enrolled, or the stored row
 * is corrupt. Unlike /enable (which decrypts a secret written moments
 * earlier), disable can run long after enrolment, so a key rotation in
 * between is a real possibility. Per "failures stay generic", surface it as
 * an invalid code rather than a 500.
 */
function tryDecryptSecret(payload: string): string | null {
  try {
    return decryptSecret(payload);
  } catch (err) {
    console.warn("[2fa/disable] decryptSecret failed; treating TOTP as invalid", err);
    return null;
  }
}

export async function POST(req: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  let body: { password?: unknown; code?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, session.sub));
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
  const secret = tryDecryptSecret(user.twoFactorSecret);
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
