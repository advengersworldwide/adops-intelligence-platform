"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, ShieldOff, KeyRound, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

export function AccountSecurity() {
  const { toast } = useToast();
  const [twoFactorEnabled, setTwoFactorEnabled] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) {
          setTwoFactorEnabled(Boolean((await res.json()).twoFactorEnabled));
        } else {
          setLoadError(true);
        }
      } catch {
        setLoadError(true);
      }
    })();
  }, []);

  const handleDisable = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/users/2fa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, code: code.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setTwoFactorEnabled(false);
        setDisableOpen(false);
        setPassword(""); setCode("");
        toast({ title: "Two-factor authentication disabled" });
      } else if (res.status === 403) {
        toast({
          title: "Two-factor authentication is mandatory for administrators",
          description: json.error ?? "Accounts with user-management access cannot disable two-factor authentication.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Couldn't disable",
          description: json.error ?? "Check your password and code.",
          variant: "destructive",
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRegenerate = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/users/2fa/backup-codes", { method: "POST" });
      if (res.ok) {
        setNewCodes((await res.json()).backupCodes);
      } else {
        toast({ title: "Couldn't regenerate codes", variant: "destructive" });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Password</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Changing your password signs you out on every other device.
        </p>
        <Button variant="outline" size="sm" onClick={() => { window.location.href = "/change-password"; }}>
          Change password
        </Button>
      </div>

      <div className="rounded-xl border border-border p-4 space-y-3">
        <div className="flex items-center gap-2">
          {twoFactorEnabled
            ? <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            : <ShieldOff className="h-4 w-4 text-muted-foreground" />}
          <h3 className="text-sm font-semibold text-foreground">Two-factor authentication</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          {loadError
            ? "Couldn't load your two-factor status. Refresh the page to try again."
            : twoFactorEnabled === null
              ? "Checking…"
              : twoFactorEnabled
                ? "Enabled. You'll be asked for a code from your authenticator app when you sign in."
                : "Not enabled. Add a second factor so a stolen password isn't enough to get in."}
        </p>

        {!loadError && twoFactorEnabled === false && (
          <Button size="sm" onClick={() => { window.location.href = "/enroll-2fa"; }}>
            Enable two-factor authentication
          </Button>
        )}

        {!loadError && twoFactorEnabled === true && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={handleRegenerate}>
              <RefreshCw className="mr-2 h-3.5 w-3.5" /> Regenerate backup codes
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDisableOpen(true)}>
              Disable
            </Button>
          </div>
        )}
      </div>

      <Dialog open={disableOpen} onOpenChange={setDisableOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Disable two-factor authentication</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Confirm with your password and a current code. Your backup codes will be deleted.
          </p>
          <div className="space-y-3">
            <Input type="password" placeholder="Current password" autoComplete="current-password"
              value={password} onChange={e => setPassword(e.target.value)} />
            <Input type="text" placeholder="6-digit code" autoComplete="one-time-code"
              value={code} onChange={e => setCode(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisableOpen(false)}>Cancel</Button>
            <Button disabled={busy || !password || !code} onClick={handleDisable}>Disable</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={newCodes !== null} onOpenChange={open => !open && setNewCodes(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Your new backup codes</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Your previous codes no longer work. Each of these works once, and they won&apos;t be shown again.
          </p>
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-muted/40 p-4">
            {newCodes?.map(c => <code key={c} className="text-center text-sm tracking-wider">{c}</code>)}
          </div>
          <DialogFooter>
            <Button onClick={() => { if (newCodes) navigator.clipboard.writeText(newCodes.join("\n")); }}>
              Copy
            </Button>
            <Button variant="outline" onClick={() => setNewCodes(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
