"use client";

import { useState } from "react";
import { Menu, Search, Bell, Sun, Moon, LogOut, AlertTriangle, AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useTheme } from "next-themes";
import { useUser, useLogout } from "@/lib/auth/user-context";
import { useGetAlerts } from "@workspace/api-client-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface TopbarProps {
  onMenuToggle: () => void;
}

export default function Topbar({ onMenuToggle }: TopbarProps) {
  const { theme, setTheme } = useTheme();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const { data: alerts } = useGetAlerts();
  const user = useUser();
  const logout = useLogout();
  const userInitials = user?.name
    ? user.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)
    : "U";

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-card px-6">
      <div className="flex items-center gap-4">
        <button
          onClick={onMenuToggle}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          data-testid="menu-toggle"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search..."
            className="w-32 sm:w-64 pl-9 text-sm bg-muted/50 border-0 focus-visible:ring-1"
            data-testid="topbar-search"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          data-testid="theme-toggle"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        <Popover>
          <PopoverTrigger asChild>
            <button className="relative rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors" data-testid="notifications-btn">
              <Bell className="h-4 w-4" />
              {alerts && alerts.length > 0 && (
                <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-destructive" />
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="end" sideOffset={8}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 bg-muted/20">
              <h4 className="text-sm font-semibold">Notifications</h4>
              {alerts && alerts.length > 0 && (
                <span className="bg-destructive text-destructive-foreground text-[10px] font-bold px-2 py-0.5 rounded-full">
                  {alerts.length} New
                </span>
              )}
            </div>
            <ScrollArea className="max-h-[400px]">
              {alerts && alerts.length > 0 ? (
                <div className="flex flex-col">
                  {alerts.map((alert) => (
                    <div
                      key={alert.id}
                      className="flex gap-3 items-start p-4 border-b border-border/50 last:border-0 hover:bg-muted/50 transition-colors"
                    >
                      <div className={cn(
                        "rounded-full p-2 shrink-0 mt-0.5",
                        alert.severity === "critical" ? "bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400" : "bg-amber-100 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400"
                      )}>
                        {alert.severity === "critical" ? <AlertCircle className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                      </div>
                      <div className="flex-1 space-y-1">
                        <p className="text-sm font-semibold leading-none">{alert.campaignName}</p>
                        <p className="text-xs text-muted-foreground leading-relaxed">{alert.message}</p>
                        <p className="text-[10px] text-muted-foreground/70 font-medium pt-1">
                          {alert.platformName} {alert.clientName ? `• ${alert.clientName}` : ''}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center text-sm text-muted-foreground flex flex-col items-center justify-center space-y-3">
                  <div className="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center">
                    <Bell className="h-6 w-6 text-muted-foreground/50" />
                  </div>
                  <p>You're all caught up!</p>
                </div>
              )}
            </ScrollArea>
          </PopoverContent>
        </Popover>

        {/* Profile Dropdown */}
        <div className="relative">
          <div
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-bold cursor-pointer hover:bg-primary/20 transition-colors"
            data-testid="avatar"
          >
            {userInitials}
          </div>

          {dropdownOpen && (
            <>
              <div
                className="fixed inset-0 z-30"
                onClick={() => setDropdownOpen(false)}
              />
              <div className="absolute right-0 mt-2 w-48 rounded-xl border border-border bg-card p-1 shadow-lg z-40 animate-in fade-in slide-in-from-top-2 duration-100">
                <div className="px-3 py-2 border-b border-border/50">
                  <p className="text-xs font-semibold text-foreground truncate">{user?.name || "Guest"}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{user?.email || ""}</p>
                </div>
                <button
                  onClick={() => {
                    setDropdownOpen(false);
                    void logout();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors cursor-pointer"
                >
                  <LogOut className="h-3.5 w-3.5 shrink-0" />
                  <span>Log Out</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
