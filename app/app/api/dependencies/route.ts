import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { getRolePermissions } from "@/lib/rbac/role-permissions";
import { effectivePermissions } from "@/lib/rbac/can";
import { getDescriptor, hasDescriptor } from "@/lib/dependencies/descriptors";
import { resolveImpact } from "@/lib/dependencies/resolve";

export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const url = new URL(req.url);
  const table = url.searchParams.get("table");
  const rawId = url.searchParams.get("id");
  if (!table || !rawId) return NextResponse.json({ error: "table and id are required" }, { status: 400 });

  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "id must be a positive integer" }, { status: 400 });

  if (!hasDescriptor(table)) return NextResponse.json({ error: `Unknown table "${table}"` }, { status: 400 });

  const rolePerms = await getRolePermissions(user.role);
  const permissions = effectivePermissions({ role: user.role, isSystem: user.isSystem }, rolePerms);

  if (!permissions.has(getDescriptor(table).deletePermission))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    return NextResponse.json(await resolveImpact(table, id, permissions));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to resolve dependencies";
    if (/not found/i.test(message)) return NextResponse.json({ error: message }, { status: 404 });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
