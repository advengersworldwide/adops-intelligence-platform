import { effectivePermissions } from "@/lib/rbac/can";

export type NextStep = "totp" | "password_change" | "enroll_2fa" | "session";

export interface StepUser {
  mustChangePassword: boolean;
  twoFactorEnabledAt: Date | null;
}

/** 2FA is mandatory for these users. Single definition — do not re-derive it. */
export function isPrivileged(role: string, isSystem: boolean, rolePermissions: string[]): boolean {
  return effectivePermissions({ role, isSystem }, rolePermissions).has("settings.users:manage");
}

/**
 * The single source of truth for login ordering. Called by the login route and
 * by every challenge-completion route, so finishing one step routes correctly
 * to the next.
 *
 * `totpDone` suppresses the TOTP branch once the second factor has been
 * satisfied in this login; without it an enrolled user would loop on "totp"
 * forever, since twoFactorEnabledAt stays set.
 */
export function resolveNextStep(
  user: StepUser,
  privileged: boolean,
  totpDone: boolean,
): NextStep {
  // 1. Second factor first — see the note in the plan on intercepted temp passwords.
  if (user.twoFactorEnabledAt && !totpDone) return "totp";
  // 2. Then any forced password change.
  if (user.mustChangePassword) return "password_change";
  // 3. Then enrolment, for privileged users who have not set up 2FA.
  if (privileged && !user.twoFactorEnabledAt) return "enroll_2fa";
  return "session";
}
