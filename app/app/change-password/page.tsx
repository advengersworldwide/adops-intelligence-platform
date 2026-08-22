"use client";

import { useState } from "react";
import { Lock, AlertCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const MIN_LENGTH = 12;

export default function ChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const tooShort = newPassword.length > 0 && newPassword.length < MIN_LENGTH;
  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors([]);
    if (newPassword !== confirmPassword) {
      setErrors(["The two passwords don't match."]);
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch("/api/users/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        if (json.next === "enroll_2fa") { window.location.href = "/enroll-2fa"; return; }
        if (json.next === "totp") { window.location.href = "/login"; return; }
        window.location.href = "/";
        return;
      }
      setErrors(json.errors ?? [json.error ?? "Unable to change password."]);
    } catch {
      setErrors(["Unable to connect to server. Please try again."]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-bold text-foreground">Choose a new password</h1>
          <p className="text-sm text-muted-foreground">
            Set a password you&apos;ll use from now on. This signs you out everywhere else.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {errors.length > 0 && (
            <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" data-testid="password-error">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <ul className="space-y-1">{errors.map(e => <li key={e}>{e}</li>)}</ul>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground" htmlFor="current-password">Current password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
              <Input id="current-password" type="password" autoComplete="current-password" required
                value={currentPassword} onChange={e => setCurrentPassword(e.target.value)}
                className="pl-9 h-10 text-sm bg-card" data-testid="current-password" />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground" htmlFor="new-password">New password</label>
            <Input id="new-password" type="password" autoComplete="new-password" required
              value={newPassword} onChange={e => setNewPassword(e.target.value)}
              className="h-10 text-sm bg-card" data-testid="new-password" />
            <p className={`text-[11px] ${tooShort ? "text-destructive" : "text-muted-foreground"}`}>
              At least {MIN_LENGTH} characters. A memorable phrase works well — no symbols required.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground" htmlFor="confirm-password">Confirm new password</label>
            <Input id="confirm-password" type="password" autoComplete="new-password" required
              value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
              className="h-10 text-sm bg-card" data-testid="confirm-password" />
            {mismatch && <p className="text-[11px] text-destructive">The two passwords don&apos;t match.</p>}
          </div>

          <Button type="submit" disabled={isLoading || tooShort || mismatch}
            className="w-full h-10 text-sm font-semibold" data-testid="password-submit">
            {isLoading ? "Saving…" : "Set new password"}
          </Button>
        </form>

        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" /> Checked against known breached passwords
        </p>
      </div>
    </div>
  );
}
