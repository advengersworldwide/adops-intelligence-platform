import { ALL_PERMISSIONS, SYSTEM_ADMIN_ROLE, type Permission } from "./catalog";

export interface Principal {
  role: string;
  isSystem: boolean;
}

export function isSuperAdmin(p: Principal): boolean {
  return p.isSystem || p.role === SYSTEM_ADMIN_ROLE;
}

export function can(granted: Set<string>, perm: Permission): boolean {
  return granted.has(perm);
}

/** Single place the admin bypass lives. Used by the server guard and /api/auth/me. */
export function effectivePermissions(principal: Principal, rolePermissions: string[]): Set<string> {
  if (isSuperAdmin(principal)) return new Set(ALL_PERMISSIONS);
  return new Set(rolePermissions);
}