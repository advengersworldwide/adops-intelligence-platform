import { describe, it, expect } from "vitest";
import { resolveNextStep, isPrivileged } from "./next-step";

const enrolled = { mustChangePassword: false, twoFactorEnabledAt: new Date() };
const notEnrolled = { mustChangePassword: false, twoFactorEnabledAt: null };

describe("resolveNextStep", () => {
  it("demands TOTP for an enrolled user", () => {
    expect(resolveNextStep(enrolled, false, false)).toBe("totp");
  });

  it("demands TOTP before a password change, even when both are pending", () => {
    const user = { mustChangePassword: true, twoFactorEnabledAt: new Date() };
    expect(resolveNextStep(user, false, false)).toBe("totp");
  });

  it("moves to password change once TOTP is satisfied", () => {
    const user = { mustChangePassword: true, twoFactorEnabledAt: new Date() };
    expect(resolveNextStep(user, false, true)).toBe("password_change");
  });

  it("issues a session once TOTP is satisfied and nothing else is pending", () => {
    expect(resolveNextStep(enrolled, false, true)).toBe("session");
  });

  it("demands a password change for an unenrolled user with a temp password", () => {
    expect(resolveNextStep({ mustChangePassword: true, twoFactorEnabledAt: null }, false, false)).toBe("password_change");
  });

  it("forces enrolment for a privileged user without 2FA", () => {
    expect(resolveNextStep(notEnrolled, true, false)).toBe("enroll_2fa");
  });

  it("does not force enrolment for a non-privileged user", () => {
    expect(resolveNextStep(notEnrolled, false, false)).toBe("session");
  });

  it("puts the password change before enrolment for a privileged user with a temp password", () => {
    expect(resolveNextStep({ mustChangePassword: true, twoFactorEnabledAt: null }, true, false)).toBe("password_change");
  });
});

describe("isPrivileged", () => {
  it("is true for isSystem", () => {
    expect(isPrivileged("Viewer", true, [])).toBe(true);
  });
  it("is true for the System Admin role", () => {
    expect(isPrivileged("System Admin", false, [])).toBe(true);
  });
  it("is true for a role holding settings.users:manage", () => {
    expect(isPrivileged("Ops Lead", false, ["settings.users:manage"])).toBe(true);
  });
  it("is false for an ordinary role", () => {
    expect(isPrivileged("Viewer", false, ["clients:view"])).toBe(false);
  });
});
