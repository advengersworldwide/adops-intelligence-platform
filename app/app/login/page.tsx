"use client";

import { useState } from "react";
import { Zap, User, Lock, AlertCircle, Eye, EyeOff, BarChart3, TrendingUp, DollarSign, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [stage, setStage] = useState<"credentials" | "totp">("credentials");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const routeNext = (next: string) => {
    if (next === "session") { window.location.href = "/"; return; }
    if (next === "password_change") { window.location.href = "/change-password"; return; }
    if (next === "enroll_2fa") { window.location.href = "/enroll-2fa"; return; }
    if (next === "totp") { setStage("totp"); setError(""); return; }
    setError("Unexpected server response. Please try again.");
  };

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const res = await fetch("/api/users/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim().toLowerCase(), password }),
      });
      if (res.ok) {
        routeNext((await res.json()).next);
      } else if (res.status === 429) {
        setError("Too many attempts. Please try again later.");
      } else {
        setError("Invalid username or password. Please try again.");
      }
    } catch {
      setError("Unable to connect to server. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const res = await fetch("/api/users/login/2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      if (res.ok) {
        routeNext((await res.json()).next);
      } else if (res.status === 429) {
        setError("Too many incorrect codes. Please try again in 15 minutes.");
      } else {
        setError("That code isn't valid. Check your authenticator app and try again.");
      }
    } catch {
      setError("Unable to connect to server. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const stats = [
    { icon: BarChart3, label: "Campaigns Tracked", value: "1,240+" },
    { icon: TrendingUp, label: "Avg Margin", value: "28.4%" },
    { icon: DollarSign, label: "Revenue Managed", value: "$4.2M" },
  ];

  return (
    <div className="min-h-screen w-full flex bg-background">
      {/* Left panel — branding */}
      <div className="hidden lg:flex lg:w-[52%] xl:w-[58%] flex-col justify-between bg-card border-r border-border p-10 relative overflow-hidden">
        {/* Subtle grid overlay */}
        <div className="absolute inset-0 opacity-[0.03] dark:opacity-[0.06]"
          style={{
            backgroundImage: "linear-gradient(hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)",
            backgroundSize: "40px 40px"
          }}
        />

        {/* Top glow accent */}
        <div className="absolute -top-32 -left-32 w-[500px] h-[500px] rounded-full opacity-10 dark:opacity-20 blur-[100px]"
          style={{ background: "hsl(var(--primary))" }}
        />
        <div className="absolute -bottom-32 -right-32 w-[400px] h-[400px] rounded-full opacity-5 dark:opacity-10 blur-[100px]"
          style={{ background: "hsl(var(--chart-4))" }}
        />

        {/* Logo */}
        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl shadow-lg"
              style={{ background: "hsl(var(--primary))" }}>
              <Zap className="h-5 w-5" style={{ color: "hsl(var(--primary-foreground))" }} />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground leading-none">AdOps Intelligence</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-0.5">Advengers Worldwide</p>
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="relative z-10 space-y-8">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/50 px-3 py-1">
              <div className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: "hsl(var(--chart-2))" }} />
              <span className="text-xs font-medium text-muted-foreground">Live Platform</span>
            </div>
            <h1 className="text-4xl xl:text-5xl font-black text-foreground leading-tight tracking-tight">
              Advertising<br />
              <span style={{ color: "hsl(var(--primary))" }}>Operations</span><br />
              Intelligence
            </h1>
            <p className="text-sm text-muted-foreground max-w-sm leading-relaxed">
              Full-stack AdOps management — track campaigns, clients, platforms, margins, and analytics from a single unified workspace.
            </p>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3">
            {stats.map(({ icon: Icon, label, value }) => (
              <div key={label} className="rounded-xl border border-border bg-background/60 p-3 backdrop-blur-sm">
                <Icon className="h-4 w-4 mb-2" style={{ color: "hsl(var(--primary))" }} />
                <p className="text-lg font-bold text-foreground">{value}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Footer note */}
        <div className="relative z-10">
          <p className="text-[10px] text-muted-foreground/60">
            © 2026 Advengers Worldwide. All rights reserved.
          </p>
        </div>
      </div>

      {/* Right panel — login form */}
      <div className="flex-1 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm space-y-8">
          {/* Mobile logo */}
          <div className="flex items-center gap-3 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl shadow-md"
              style={{ background: "hsl(var(--primary))" }}>
              <Zap className="h-4 w-4" style={{ color: "hsl(var(--primary-foreground))" }} />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground leading-none">AdOps Intelligence</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Advengers Worldwide</p>
            </div>
          </div>

          {/* Header */}
          <div className="space-y-1.5">
            <h2 className="text-2xl font-bold text-foreground">
              {stage === "totp" ? "Two-factor verification" : "Sign in"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {stage === "totp"
                ? "One more step to secure your account."
                : "Enter your credentials to access your workspace."}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleCredentials} className="space-y-5">
            {/* Error */}
            {error && (
              <div className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" data-testid="login-error">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {stage === "credentials" && (
              <>
                {/* Username */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground" htmlFor="login-username">
                    Username
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <Input
                      id="login-username"
                      type="text"
                      autoComplete="username"
                      required
                      placeholder="your.username"
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      className="pl-9 h-10 text-sm bg-card"
                      data-testid="login-username"
                    />
                  </div>
                </div>

                {/* Password */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground" htmlFor="login-password">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <Input
                      id="login-password"
                      type={showPassword ? "text" : "password"}
                      required
                      placeholder="••••••••"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="pl-9 pr-10 h-10 text-sm bg-card"
                      data-testid="login-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {/* Submit */}
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full h-10 text-sm font-semibold"
                  data-testid="login-submit"
                >
                  {isLoading ? (
                    <span className="flex items-center gap-2">
                      <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Signing in…
                    </span>
                  ) : "Sign in"}
                </Button>
              </>
            )}

            {stage === "totp" && (
              <div className="space-y-5">
                <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 p-3">
                  <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Enter the 6-digit code from your authenticator app. You can also use one of your backup codes.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground" htmlFor="login-code">
                    Verification code
                  </label>
                  <Input
                    id="login-code"
                    type="text"
                    inputMode="text"
                    autoComplete="one-time-code"
                    autoFocus
                    required
                    placeholder="123456"
                    value={code}
                    onChange={e => setCode(e.target.value)}
                    className="h-10 text-sm bg-card tracking-widest"
                    data-testid="login-code"
                  />
                </div>
                <Button type="button" onClick={handleCode} disabled={isLoading}
                  className="w-full h-10 text-sm font-semibold" data-testid="login-verify">
                  {isLoading ? "Verifying…" : "Verify"}
                </Button>
                <button type="button" onClick={() => { setStage("credentials"); setCode(""); setError(""); }}
                  className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors">
                  Back to sign in
                </button>
              </div>
            )}
          </form>

          {/* Divider note */}
          <p className="text-center text-xs text-muted-foreground">
            Secure access · Role-based permissions · Advengers Worldwide
          </p>
        </div>
      </div>
    </div>
  );
}
