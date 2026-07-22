import { NextResponse } from "next/server";
import { getSession } from "./session";
import type { SessionUser } from "./jwt";
import { getRolePermissions } from "@/lib/rbac/role-permissions";
import { effectivePermissions } from "@/lib/rbac/can";
import type { Permission } from "@/lib/rbac/catalog";

type AuthResult = { user: SessionUser } | Response;

export async function requireAuth(): Promise<AuthResult> {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  return { user };
}

export async function requireAdmin(): Promise<AuthResult> {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (user.role !== "System Admin" && !user.isSystem)
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  return { user };
}

export async function requirePermission(perm: Permission): Promise<AuthResult> {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const rolePerms = await getRolePermissions(user.role);
  const eff = effectivePermissions({ role: user.role, isSystem: user.isSystem }, rolePerms);
  if (!eff.has(perm)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return { user };
}

export function isAuthError(result: AuthResult): result is Response {
  return result instanceof Response;
}
