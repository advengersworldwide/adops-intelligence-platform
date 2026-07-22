import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getRolePermissions } from "@/lib/rbac/role-permissions";
import { effectivePermissions } from "@/lib/rbac/can";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const rolePerms = await getRolePermissions(user.role);
  const eff = effectivePermissions({ role: user.role, isSystem: user.isSystem ?? false }, rolePerms);
  return NextResponse.json({
    id: user.sub,
    name: user.name,
    email: user.email,
    role: user.role,
    isSystem: user.isSystem ?? false,
    permissions: [...eff],
  });
}
