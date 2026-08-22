"use client";

import { AccountSecurity } from "@/components/settings/AccountSecurity";

// Not wrapped in PermissionGuard: password and 2FA are personal settings that
// belong to every signed-in user, not gated behind any settings.* permission.
// (Auth itself is still enforced by middleware — see middleware.ts's matcher.)
export default function AccountPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Account Security</h1>
        <p className="text-sm text-muted-foreground">Manage your password and two-factor authentication.</p>
      </div>
      <div className="max-w-2xl">
        <AccountSecurity />
      </div>
    </div>
  );
}
