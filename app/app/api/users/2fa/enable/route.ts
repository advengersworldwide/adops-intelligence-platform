import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, usersTable, userBackupCodesTable } from "@workspace/db";
import { resolveActor } from "@/lib/auth/actor";
import { verifyTotp } from "@/lib/auth/totp";
import { decryptSecret } from "@/lib/auth/secret-crypto";
import { generateBackupCodes, hashBackupCode } from "@/lib/auth/credentials";

export const runtime = "nodejs";

/**
 * `decryptSecret` throws when the AES-GCM auth tag fails to verify — e.g. if
 * TOTP_ENCRYPTION_KEY was rotated between /setup and this call, or the stored
 * row is corrupt. That is a server-side condition, not evidence the submitted
 * code is wrong, but per the "failures stay generic" rule we must not leak it
 * as a 500: treat it the same as an invalid code.
 */
function tryDecryptSecret(payload: string): string | null {
  try {
    return decryptSecret(payload);
  } catch (err) {
    console.warn("[2fa/enable] decryptSecret failed; treating TOTP as invalid", err);
    return null;
  }
}

export async function POST(req: Request): Promise<Response> {
  const userId = await resolveActor(req, "totp_enroll");
  if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  let body: { code?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const code = String(body.code ?? "").trim();

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!user.twoFactorSecret) {
    return NextResponse.json({ error: "Start setup before enabling two-factor authentication" }, { status: 400 });
  }
  if (user.twoFactorEnabledAt) {
    return NextResponse.json({ error: "Two-factor authentication is already enabled" }, { status: 400 });
  }

  // Requiring a valid code proves the user actually scanned the QR — otherwise
  // we would lock them out of their own account at the next login.
  const secret = tryDecryptSecret(user.twoFactorSecret);
  const result = secret ? verifyTotp(secret, code, null) : { valid: false, step: null };
  if (!result.valid) return NextResponse.json({ error: "Invalid code" }, { status: 401 });

  const codes = generateBackupCodes();
  const rows = await Promise.all(
    codes.map(async (c) => ({ userId: user.id, codeHash: await hashBackupCode(c) })),
  );
  await db.insert(userBackupCodesTable).values(rows);

  await db
    .update(usersTable)
    .set({
      twoFactorEnabledAt: new Date(),
      lastTotpStep: result.step,
      twoFactorFailedAttempts: 0,
      twoFactorLockedUntil: null,
    })
    .where(eq(usersTable.id, user.id));

  // Shown exactly once — they are hashed at rest and cannot be recovered.
  return NextResponse.json({ backupCodes: codes });
}
