"use client";

import { createContext, useContext, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { Permission } from "@/lib/rbac/catalog";

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  role: string;
  isSystem: boolean;
  permissions: string[];
}

interface UserContextValue {
  user: SessionUser | null;
  isLoading: boolean;
}

const UserContext = createContext<UserContextValue>({ user: null, isLoading: true });

export function computeCan(permissions: string[] | null, permission: Permission): boolean {
  if (!permissions) return false;
  return permissions.includes(permission);
}

export function UserProvider({ children }: { children: React.ReactNode }) {
  const { data: user = null, isLoading } = useQuery<SessionUser | null>({
    queryKey: ["me"],
    queryFn: async () => {
      const res = await fetch("/api/auth/me");
      if (!res.ok) return null;
      return res.json() as Promise<SessionUser>;
    },
    staleTime: Infinity,
    retry: false,
  });

  return <UserContext.Provider value={{ user, isLoading }}>{children}</UserContext.Provider>;
}

export function useUser(): SessionUser | null {
  return useContext(UserContext).user;
}

/** Returns true/false, or null while the session is still loading. */
export function useHasPermission(permission: Permission): boolean | null {
  const { user, isLoading } = useContext(UserContext);
  if (isLoading) return null;
  if (!user) return false;
  return computeCan(user.permissions, permission);
}

export function useCan(): (permission: Permission) => boolean {
  const { user } = useContext(UserContext);
  const set = useMemo(() => new Set(user?.permissions ?? []), [user?.permissions]);
  return (permission: Permission) => set.has(permission);
}

export function usePermissionSet(): { has: (p: Permission) => boolean; isLoading: boolean } {
  const { user, isLoading } = useContext(UserContext);
  const set = useMemo(() => new Set(user?.permissions ?? []), [user?.permissions]);
  return { has: (p: Permission) => set.has(p), isLoading };
}

export function useLogout() {
  const router = useRouter();
  const queryClient = useQueryClient();
  return async () => {
    await fetch("/api/users/logout", { method: "POST" });
    queryClient.clear();
    router.push("/login");
  };
}
