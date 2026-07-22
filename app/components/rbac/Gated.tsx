"use client";
import { useCan } from "@/lib/auth/user-context";
import type { Permission } from "@/lib/rbac/catalog";

export function Gated({ permission, children }: { permission: Permission; children: React.ReactNode }) {
  const can = useCan();
  if (!can(permission)) return null;
  return <>{children}</>;
}
