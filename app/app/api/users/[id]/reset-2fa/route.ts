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

  // The "clearing 2FA merely forces re-enrolment" argument is a race, not a
  // guarantee: an attacker who strips a system account's second factor and
  // then obtains its password by other means (phishing, credential reuse)
  // performs the forced re-enrolment themselves and durably owns the second
  // factor. settings.users:manage is a catalog permission grantable to any
  // role, so without this check the population able to do that is "whoever
  // holds that permission," not "another system admin." Non-system accounts
  // have no such asymmetry, so this restriction applies only to system
  // targets.
  if (user.isSystem && !auth.user.isSystem) {
    return NextResponse.json(
      { error: "A system account's two-factor authentication can only be reset by another system account." },
      { status: 403 },
    );
  }

  // Clearing the secret forces re-enrolment at the next login for privileged
  // users, and simply disables 2FA for everyone else. Both statements run in
  // one transaction: a failure between them would otherwise leave the target
  // with 2FA still enforced, no recovery codes, and no tokenVersion bump —
  // on the account-recovery path specifically.
  await db.transaction(async (tx) => {
    await tx.delete(userBackupCodesTable).where(eq(userBackupCodesTable.userId, user.id));
    await tx
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
  });

  return NextResponse.json({ ok: true });
}
