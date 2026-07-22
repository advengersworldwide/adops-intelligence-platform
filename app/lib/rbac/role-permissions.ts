import { eq } from "drizzle-orm";
import { db, rolesTable } from "@workspace/db";

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { perms: string[]; expires: number }>();

export async function getRolePermissions(roleName: string): Promise<string[]> {
  const now = Date.now();
  const hit = cache.get(roleName);
  if (hit && hit.expires > now) return hit.perms;
  const rows = await db.select().from(rolesTable).where(eq(rolesTable.name, roleName));
  const perms = rows[0]?.permissions ?? [];
  cache.set(roleName, { perms, expires: now + CACHE_TTL_MS });
  return perms;
}

export function clearRolePermissionsCache(): void {
  cache.clear();
}