"use client";

import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useHasPermission } from "@/lib/auth/user-context";
import type { Permission } from "@/lib/rbac/catalog";

function AccessDenied() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6 space-y-4">
      <div className="rounded-full bg-red-50 dark:bg-red-950/30 p-4 text-red-600 dark:text-red-400">
        <ShieldAlert className="h-12 w-12 animate-pulse" />
      </div>
      <h2 className="text-xl font-bold text-foreground">Access Denied</h2>
      <p className="text-sm text-muted-foreground max-w-sm">
        Your account role does not have the permissions required to access this module. Please contact your system administrator.
      </p>
      <Link href="/">
        <Button variant="outline" className="mt-2 text-xs">
          Return to Dashboard
        </Button>
      </Link>
    </div>
  );
}

export function PermissionGuard({
  permission,
  children,
}: {
  permission: Permission;
  children: React.ReactNode;
}) {
  const allowed = useHasPermission(permission);

  if (allowed === null) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!allowed) return <AccessDenied />;
  return <>{children}</>;
}
