import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { getSession } from "./session";
import type { SessionUser } from "./jwt";
import { getRolePermissions } from "@/lib/rbac/role-permissions";
import { effectivePermissions } from "@/lib/rbac/can";
import type { Permission } from "@/lib/rbac/catalog";

type AuthResult = { user: SessionUser } | Response;

const unauthenticated = () =>
  NextResponse.json({ error: "Authentication required" }, { status: 401 });

/**
 * Sessions are stateless JWTs, so revocation works by comparing the token's
 * tokenVersion against the database. Bumped on password change, admin password
 * reset, 2FA reset and 2FA disable — any of which must kill live sessions.
 *
 * This is one indexed primary-key lookup; these guards already query the
 * database for role permissions, so it adds no round trip in practice.
 */
async function isCurrentSession(user: SessionUser): Promise<boolean> {
  const [row] = await db
    .select({ tokenVersion: usersTable.tokenVersion })
    .from(usersTable)
    .where(eq(usersTable.id, user.sub));
  return Boolean(row) && row.tokenVersion === user.tokenVersion;
}

/** Resolves the session and verifies it has not been revoked. */
async function getLiveSession(): Promise<SessionUser | null> {
  const user = await getSession();
  if (!user) return null;
  return (await isCurrentSession(user)) ? user : null;
}

export async function requireAuth(): Promise<AuthResult> {
  const user = await getLiveSession();
  if (!user) return unauthenticated();
  return { user };
}

export async function requireAdmin(): Promise<AuthResult> {
  const user = await getLiveSession();
  if (!user) return unauthenticated();
  if (user.role !== "System Admin" && !user.isSystem)
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  return { user };
}

export async function requirePermission(perm: Permission): Promise<AuthResult> {
  const user = await getLiveSession();
  if (!user) return unauthenticated();
  const rolePerms = await getRolePermissions(user.role);
  const eff = effectivePermissions({ role: user.role, isSystem: user.isSystem }, rolePerms);
  if (!eff.has(perm)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return { user };
}

export function isAuthError(result: AuthResult): result is Response {
  return result instanceof Response;
}
