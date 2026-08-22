import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db, usersTable, userBackupCodesTable } from "@workspace/db";
import { verifyChallenge } from "@/lib/auth/jwt";
import { readChallengeCookie } from "@/lib/auth/actor";
import { verifyTotp } from "@/lib/auth/totp";
import { tryDecryptSecret } from "@/lib/auth/secret-crypto";
import { verifyBackupCode } from "@/lib/auth/credentials";
import { resolveNextStep, isPrivileged } from "@/lib/auth/next-step";
import { issueSession, issueChallenge } from "@/lib/auth/session-issue";
import { getRolePermissions } from "@/lib/rbac/role-permissions";

export const runtime = "nodejs";
// The backup-code fallback loop below is bulk bcrypt work (up to ten compares).
export const maxDuration = 30;

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

const INVALID = () => NextResponse.json({ error: "Invalid code" }, { status: 401 });

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
  const secret = tryDecryptSecret(user.twoFactorSecret, "login/2fa");
  const totp = secret ? verifyTotp(secret, code, user.lastTotpStep ?? null) : { valid: false, step: null };

  if (!totp.valid) {
    // Persisted immediately, before the backup-code loop below — not after it.
    // That loop is bulk bcrypt work (up to ten compares against unused codes),
    // and a request timeout mid-loop must not skip this write, or the
    // five-attempt lockout would silently never engage. maxDuration above and
    // the lower backup-code bcrypt cost (credentials.ts) both shrink that
    // risk, but this ordering is the actual guarantee.
    const attempts = user.twoFactorFailedAttempts + 1;
    await db
      .update(usersTable)
      .set({
        twoFactorFailedAttempts: attempts,
        twoFactorLockedUntil: attempts >= MAX_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MS) : null,
      })
      .where(eq(usersTable.id, user.id));
  }

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
    // The failure counter above is already persisted — nothing left to do here.
    return INVALID();
  }

  // Success — clear the counters (undoing the pre-loop increment above, if a
  // backup code is what actually succeeded) and record the consumed step so
  // the same code cannot be replayed inside its remaining validity window.
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
