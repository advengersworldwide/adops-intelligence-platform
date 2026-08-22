"use client";

import { useEffect, useRef, useState } from "react";
import { AlertCircle, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Stage = "loading" | "scan" | "codes";

export default function Enroll2faPage() {
  const [stage, setStage] = useState<Stage>("loading");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  // React Strict Mode double-invokes effects in dev, and this one calls a POST
  // endpoint that overwrites two_factor_secret every time it runs. A second,
  // unguarded call would rewrite the secret out from under the QR code already
  // on screen, so the code the user scanned no longer verifies. Ref (not
  // state) because the guard must be synchronous and must not itself trigger
  // a re-render/re-run.
  const setupStarted = useRef(false);
  // Where to send the user once 2FA is confirmed enabled — set from the
  // server's response, the same way the login page routes on `next` rather
  // than assuming session is always the outcome (a forced password change can
  // still be pending).
  const [nextStep, setNextStep] = useState<string | null>(null);

  useEffect(() => {
    if (setupStarted.current) return;
    setupStarted.current = true;
    (async () => {
      try {
        const res = await fetch("/api/users/2fa/setup", { method: "POST" });
        if (!res.ok) { setError("Unable to start setup. Please sign in again."); setStage("scan"); return; }
        const json = await res.json();
        setQrDataUrl(json.qrDataUrl);
        setSecret(json.secret);
        setStage("scan");
      } catch {
        setError("Unable to connect to server.");
        setStage("scan");
      }
    })();
  }, []);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const res = await fetch("/api/users/2fa/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setBackupCodes(json.backupCodes ?? []);
        setNextStep(json.next ?? "session");
        setStage("codes");
        return;
      }
      setError(json.error ?? "That code isn't valid. Try the next one your app shows.");
    } catch {
      setError("Unable to connect to server.");
    } finally {
      setIsLoading(false);
    }
  };

  const routeNext = () => {
    if (nextStep === "password_change") { window.location.href = "/change-password"; return; }
    // "session" is the common case; any other/unexpected value still lands
    // safely on "/" rather than stranding the user on this page.
    window.location.href = "/";
  };

  const copyCodes = async () => {
    await navigator.clipboard.writeText(backupCodes.join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-sm space-y-8">
        {stage !== "codes" ? (
          <>
            <div className="space-y-1.5">
              <h1 className="text-2xl font-bold text-foreground">Set up two-factor authentication</h1>
              <p className="text-sm text-muted-foreground">
                Scan this with Google Authenticator, Authy, or 1Password, then enter the code it shows.
              </p>
            </div>

            {error && (
              <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" data-testid="enroll-error">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" /><span>{error}</span>
              </div>
            )}

            {stage === "loading" ? (
              <div className="h-48 animate-pulse rounded-xl bg-muted" />
            ) : (
              qrDataUrl && (
                <div className="space-y-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qrDataUrl} alt="Two-factor setup QR code"
                    className="mx-auto h-48 w-48 rounded-xl border border-border bg-white p-2" />
                  <details className="text-center">
                    <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                      Can&apos;t scan? Enter this key manually
                    </summary>
                    <code className="mt-2 block break-all rounded-lg bg-muted p-2 text-[11px] tracking-wider">{secret}</code>
                  </details>
                </div>
              )
            )}

            <form onSubmit={handleVerify} className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground" htmlFor="enroll-code">Verification code</label>
                <Input id="enroll-code" type="text" inputMode="numeric" autoComplete="one-time-code" required
                  placeholder="123456" value={code} onChange={e => setCode(e.target.value)}
                  className="h-10 text-sm bg-card tracking-widest" data-testid="enroll-code" />
              </div>
              <Button type="submit" disabled={isLoading || stage === "loading"}
                className="w-full h-10 text-sm font-semibold" data-testid="enroll-submit">
                {isLoading ? "Verifying…" : "Verify and enable"}
              </Button>
            </form>
          </>
        ) : (
          <>
            <div className="space-y-1.5">
              <h1 className="text-2xl font-bold text-foreground">Save your backup codes</h1>
              <p className="text-sm text-muted-foreground">
                Each code works once, and this is the only time they&apos;ll be shown. Store them somewhere safe —
                they&apos;re how you get in if you lose your phone.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-muted/40 p-4" data-testid="backup-codes">
              {backupCodes.map(c => (
                <code key={c} className="text-center text-sm tracking-wider text-foreground">{c}</code>
              ))}
            </div>

            <Button type="button" variant="outline" onClick={copyCodes} className="w-full h-10 text-sm">
              {copied ? <><Check className="mr-2 h-4 w-4" />Copied</> : <><Copy className="mr-2 h-4 w-4" />Copy all codes</>}
            </Button>

            <label className="flex items-start gap-2.5 text-sm text-foreground">
              <input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border" data-testid="codes-saved" />
              <span>I&apos;ve saved these codes somewhere safe.</span>
            </label>

            <Button type="button" disabled={!saved} onClick={routeNext}
              className="w-full h-10 text-sm font-semibold" data-testid="enroll-done">
              Continue to dashboard
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
