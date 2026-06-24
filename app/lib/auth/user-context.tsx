"use client";

import { createContext, useContext } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  role: string;
  isSystem: boolean;
}

interface Role {
  name: string;
  permissions: string[];
  isSystem?: boolean;
}

interface UserContextValue {
  user: SessionUser | null;
  isLoading: boolean;
}

const UserContext = createContext<UserContextValue>({ user: null, isLoading: true });

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

  return (
    <UserContext.Provider value={{ user, isLoading }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser(): SessionUser | null {
  return useContext(UserContext).user;
}

export function useHasPermission(permission: string): boolean | null {
  const { user, isLoading } = useContext(UserContext);

  const { data: roles } = useQuery<Role[]>({
    queryKey: ["roles"],
    queryFn: () => fetch("/api/roles").then(r => r.json()),
    staleTime: Infinity,
    enabled: !!user && user.role !== "System Admin" && !user.isSystem,
  });

  if (isLoading) return null;
  if (!user) return false;
  if (user.role === "System Admin" || user.isSystem) return true;
  if (!roles) return null; // roles still loading
  const userRole = roles.find(r => r.name.toLowerCase() === user.role.toLowerCase());
  return userRole?.permissions.includes(permission) ?? false;
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
