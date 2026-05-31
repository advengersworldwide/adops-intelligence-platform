import { Sun, Moon, Monitor, Bell, Shield, Database, Palette } from "lucide-react";
import { useTheme } from "@/components/theme-provider";

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your platform preferences and configuration</p>
      </div>

      {/* Theme */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Palette className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Appearance</h2>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[
            { value: "light" as const, label: "Light", icon: Sun },
            { value: "dark" as const, label: "Dark", icon: Moon },
            { value: "system" as const, label: "System", icon: Monitor },
          ].map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              onClick={() => setTheme(value)}
              data-testid={`theme-${value}`}
              className={`flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all ${
                theme === value
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border text-muted-foreground hover:border-muted-foreground/30 hover:bg-muted/30"
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="text-xs font-medium">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Notifications */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Bell className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Notifications</h2>
        </div>
        <div className="space-y-3">
          {[
            { label: "Alert on negative profit", description: "Notify when any campaign goes negative" },
            { label: "Low margin warnings", description: "Alert when margin drops below 10%" },
            { label: "Weekly performance report", description: "Receive summary every Monday" },
          ].map(item => (
            <div key={item.label} className="flex items-center justify-between py-2 border-b border-border last:border-0">
              <div>
                <p className="text-sm font-medium text-foreground">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.description}</p>
              </div>
              <div className="h-5 w-9 rounded-full bg-primary flex items-center cursor-pointer">
                <div className="ml-auto mr-1 h-3.5 w-3.5 rounded-full bg-white shadow-sm" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Data & Privacy */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Shield className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">Data & Privacy</h2>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between py-2 border-b border-border">
            <div>
              <p className="text-sm font-medium text-foreground">Data Retention</p>
              <p className="text-xs text-muted-foreground">Keep transaction data for</p>
            </div>
            <span className="rounded-full bg-secondary px-3 py-1 text-xs font-medium">24 months</span>
          </div>
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium text-foreground">Analytics</p>
              <p className="text-xs text-muted-foreground">Usage data collection</p>
            </div>
            <div className="h-5 w-9 rounded-full bg-muted border border-border flex items-center cursor-pointer">
              <div className="ml-1 h-3.5 w-3.5 rounded-full bg-muted-foreground shadow-sm" />
            </div>
          </div>
        </div>
      </div>

      {/* About */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <Database className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">About</h2>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">Version</span><span className="font-medium text-foreground">1.0.0</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Stack</span><span className="font-medium text-foreground">React + Express + PostgreSQL</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Platform</span><span className="font-medium text-foreground">AdOps Intelligence</span></div>
        </div>
      </div>
    </div>
  );
}
