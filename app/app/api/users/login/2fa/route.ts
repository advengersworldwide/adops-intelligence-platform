import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db, usersTable, userBackupCodesTable } from "@workspace/db";
import { verifyChallenge } from "@/lib/auth/jwt";
import { readChallengeCookie } from "@/lib/auth/actor";
import { verifyTotp } from "@/lib/auth/totp";
import { decryptSecret } from "@/lib/auth/secret-crypto";
import { verifyBackupCode } from "@/lib/auth/credentials";
import { resolveNextStep, isPrivileged } from "@/lib/auth/next-step";
import { issueSession, issueChallenge } from "@/lib/auth/session-issue";
import { getRolePermissions } from "@/lib/rbac/role-permissions";

export const runtime = "nodejs";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

const INVALID = () => NextResponse.json({ error: "Invalid code" }, { status: 401 });

/**
 * `decryptSecret` throws when the AES-GCM auth tag fails to verify — which
 * happens if TOTP_ENCRYPTION_KEY was rotated or the stored row is corrupt.
 * That is a server-side condition, not evidence the submitted code is wrong,
 * but we still must not leak it: surface it as "no code will validate this
 * step" so the caller falls through to the same generic invalid-code
 * response (and still gets a chance at a backup code) instead of a 500.
 */
function tryDecryptSecret(payload: string): string | null {
  try {
    return decryptSecret(payload);
  } catch (err) {
    // Server-side signal only — never surfaced to the caller. Without this,
    // a rotated TOTP_ENCRYPTION_KEY or corrupt row is indistinguishable from
    // users mistyping codes: every enrolled user starts failing 2FA and the
    // only symptom is a spike in generic lockouts.
    console.warn("[login/2fa] decryptSecret failed; treating TOTP as invalid", err);
    return null;
  }
}

export async function POST(req: Request): Promise<Response> {
  const token = readChallengeCookie(req);
  if (!token) return INVALID();

  let sub: number;
  try {
    ({ sub } = await verifyChallenge(token, "totp"));
  } catch {
    return INVALID();
  }

  let body: { code?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const code = String(body.code ?? "").trim();
  if (!code) return NextResponse.json({ error: "code is required" }, { status: 400 });

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, sub));
  if (!user || !user.twoFactorSecret || !user.twoFactorEnabledAt) return INVALID();

  if (user.twoFactorLockedUntil && user.twoFactorLockedUntil.getTime() > Date.now()) {
    return NextResponse.json(
      { error: "Too many incorrect codes. Try again in 15 minutes." },
      { status: 429 },
    );
  }

  // Try the authenticator code first, then fall back to backup codes.
  const secret = tryDecryptSecret(user.twoFactorSecret);
  const totp = secret ? verifyTotp(secret, code, user.lastTotpStep ?? null) : { valid: false, step: null };

  let matchedBackupCodeId: number | null = null;
  if (!totp.valid) {
    const unused = await db
      .select()
      .from(userBackupCodesTable)
      .where(and(eq(userBackupCodesTable.userId, user.id), isNull(userBackupCodesTable.usedAt)));
    for (const row of unused) {
      if (await verifyBackupCode(code, row.codeHash)) {
        matchedBackupCodeId = row.id;
        break;
      }
    }
  }

  if (!totp.valid && matchedBackupCodeId === null) {
    const attempts = user.twoFactorFailedAttempts + 1;
    await db
      .update(usersTable)
      .set({
        twoFactorFailedAttempts: attempts,
        twoFactorLockedUntil: attempts >= MAX_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MS) : null,
      })
      .where(eq(usersTable.id, user.id));
    return INVALID();
  }

  // Success — clear the counters and record the consumed step so the same code
  // cannot be replayed inside its remaining validity window.
  await db
    .update(usersTable)
    .set({
      twoFactorFailedAttempts: 0,
      twoFactorLockedUntil: null,
      ...(totp.valid ? { lastTotpStep: totp.step } : {}),
    })
    .where(eq(usersTable.id, user.id));

  if (matchedBackupCodeId !== null) {
    await db
      .update(userBackupCodesTable)
      .set({ usedAt: new Date() })
      .where(eq(userBackupCodesTable.id, matchedBackupCodeId));
  }

  const rolePerms = await getRolePermissions(user.role);
  const privileged = isPrivileged(user.role, user.isSystem, rolePerms);
  const step = resolveNextStep(user, privileged, true);

  if (step === "session") return issueSession(user);
  return issueChallenge(user.id, step, true);
}
