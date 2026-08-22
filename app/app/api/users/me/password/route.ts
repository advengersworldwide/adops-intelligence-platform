import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { resolveActor, readChallengeCookie } from "@/lib/auth/actor";
import { verifyChallenge } from "@/lib/auth/jwt";
import { validatePassword } from "@/lib/auth/password-policy";
import { resolveNextStep, isPrivileged } from "@/lib/auth/next-step";
import { issueSession, issueChallenge } from "@/lib/auth/session-issue";
import { getRolePermissions } from "@/lib/rbac/role-permissions";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const BCRYPT_ROUNDS = 12;

export async function POST(req: Request): Promise<Response> {
  const userId = await resolveActor(req, "password_change");
  if (!userId) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

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
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  if (!(await bcrypt.compare(currentPassword, user.password))) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
  }

  // currentPassword has just been proven genuine by the bcrypt.compare above
  // (it matches the stored hash), so a plain string comparison against it is
  // an exact reuse check — no second bcrypt round-trip needed.
  if (newPassword === currentPassword) {
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

  // Carry forward whether the second factor was already satisfied this login.
  // A signed-in user calling this from settings has no challenge cookie at
  // all — their session already implies any required TOTP was satisfied to
  // obtain it, so totpDone defaults to true. A half-authenticated caller mid
  // login carries a password_change challenge whose totpDone claim records
  // whether TOTP was done earlier in this same login; that is what must be
  // forwarded into the next resolveNextStep call so the user is neither
  // looped back through TOTP nor allowed to skip it.
  let totpDone = true;
  const challenge = readChallengeCookie(req);
  if (challenge) {
    try {
      totpDone = (await verifyChallenge(challenge, "password_change")).totpDone;
    } catch {
      totpDone = true;
    }
  }

  const updated = { ...user, mustChangePassword: false, tokenVersion: nextVersion };
  const rolePerms = await getRolePermissions(user.role);
  const privileged = isPrivileged(user.role, user.isSystem, rolePerms);
  const step = resolveNextStep(updated, privileged, totpDone);

  if (step === "session") return issueSession(updated);
  return issueChallenge(user.id, step, totpDone);
}
