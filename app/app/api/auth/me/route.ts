import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { getSession } from "@/lib/auth/session";
import { isCurrentSession } from "@/lib/auth/require";
import { getRolePermissions } from "@/lib/rbac/role-permissions";
import { effectivePermissions } from "@/lib/rbac/can";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  // Can't use requireAuth here — this route must return the bootstrap
  // permission set and profile fields (username, 2FA state) alongside the
  // user, not just gate on being authenticated. The revocation check itself
  // is shared with requireAuth via isCurrentSession rather than a second,
  // drifting copy of the tokenVersion comparison. Run alongside the row fetch
  // below (both are independent lookups) rather than sequentially.
  const [currentSession, [row]] = await Promise.all([
    isCurrentSession(user),
    db.select().from(usersTable).where(eq(usersTable.id, user.sub)),
  ]);
  if (!currentSession || !row) {
    return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  }

  const rolePerms = await getRolePermissions(user.role);
  const eff = effectivePermissions({ role: user.role, isSystem: user.isSystem ?? false }, rolePerms);
  return NextResponse.json({
    id: user.sub,
    name: user.name,
    username: row.username,
    email: user.email,
    role: user.role,
    isSystem: user.isSystem ?? false,
    twoFactorEnabled: Boolean(row.twoFactorEnabledAt),
    permissions: [...eff],
  });
}
