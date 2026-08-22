import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { resolveActor, readChallengeCookie } from "@/lib/auth/actor";
import { getSession } from "@/lib/auth/session";
import { isCurrentSession } from "@/lib/auth/require";
import { verifyChallenge } from "@/lib/auth/jwt";
import { validatePassword } from "@/lib/auth/password-policy";
import { resolveNextStep, isPrivileged } from "@/lib/auth/next-step";
import { issueSession, issueChallenge } from "@/lib/auth/session-issue";
import { getRolePermissions } from "@/lib/rbac/role-permissions";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const BCRYPT_ROUNDS = 12;

const unauthenticated = () =>
  NextResponse.json({ error: "Authentication required" }, { status: 401 });

export async function POST(req: Request): Promise<Response> {
  const userId = await resolveActor(req, "password_change");
  if (!userId) return unauthenticated();

  // Which of resolveActor's two paths produced this actor decides whether
  // the second factor should be considered satisfied for the *next* step
  // resolution below. A live, non-revoked session means TOTP (if required)
  // was already satisfied to obtain that session — a stale password_change
  // or totp_enroll challenge cookie can coexist alongside it (issueChallenge
  // never clears the session cookie, per Task 11) and must be ignored when a
  // real session is present. Otherwise the actor was resolved from the
  // challenge cookie itself, whose own totpDone claim is authoritative. This
  // is re-derived explicitly here (rather than guessed from cookie
  // presence) because resolveActor doesn't expose which branch it took.
  const session = await getSession();
  const liveSession = session ? await isCurrentSession(session) : false;

  let totpDone: boolean;
  if (liveSession) {
    totpDone = true;
  } else {
    // resolveActor just verified this exact token to resolve `userId` above,
    // so a failure here means something is genuinely wrong (e.g. the token
    // expired in the instant between the two checks). totpDone gates whether
    // the second factor is considered satisfied — it must never default open
    // on a verification failure, so this is a hard 401, not a fallback.
    const challenge = readChallengeCookie(req);
    if (!challenge) return unauthenticated();
    try {
      totpDone = (await verifyChallenge(challenge, "password_change")).totpDone;
    } catch (err) {
      console.warn("[users/me/password] challenge re-verification failed", err);
      return unauthenticated();
    }
  }

  const { success } = await checkRateLimit("password-change", String(userId));
  if (!success) {
    return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
  }

  let body: { currentPassword?: unknown; newPassword?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const currentPassword = String(body.currentPassword ?? "");
  const newPassword = String(body.newPassword ?? "");
  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "currentPassword and newPassword are required" }, { status: 400 });
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) return unauthenticated();

  if (!(await bcrypt.compare(currentPassword, user.password))) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
  }

  // Checked against the stored hash, not the submitted currentPassword
  // string: bcrypt truncates at 72 bytes, so two different passwords
  // sharing a 72-byte prefix are bcrypt-indistinguishable. currentPassword
  // itself was never subject to that cap (it predates the password policy),
  // so a plain string comparison here could be fooled by a truncated
  // resubmission that bcrypt would correctly recognize as the same secret.
  if (await bcrypt.compare(newPassword, user.password)) {
    return NextResponse.json(
      { errors: ["Your new password must be different from your current one."] },
      { status: 400 },
    );
  }

  const validation = await validatePassword(newPassword);
  if (!validation.ok) {
    return NextResponse.json({ errors: validation.errors }, { status: 400 });
  }

  // Bumping tokenVersion invalidates every session issued before this change —
  // the point of changing a password you believe was stolen.
  const nextVersion = user.tokenVersion + 1;
  await db
    .update(usersTable)
    .set({
      password: await bcrypt.hash(newPassword, BCRYPT_ROUNDS),
      mustChangePassword: false,
      passwordChangedAt: new Date(),
      tokenVersion: nextVersion,
    })
    .where(eq(usersTable.id, user.id));

  const updated = { ...user, mustChangePassword: false, tokenVersion: nextVersion };
  const rolePerms = await getRolePermissions(user.role);
  const privileged = isPrivileged(user.role, user.isSystem, rolePerms);
  const step = resolveNextStep(updated, privileged, totpDone);

  if (step === "session") return issueSession(updated);
  return issueChallenge(user.id, step, totpDone);
}
