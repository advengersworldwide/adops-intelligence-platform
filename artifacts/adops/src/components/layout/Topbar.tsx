import { useState } from "react";
import { Menu, Search, Bell, Sun, Moon, LogOut } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useTheme } from "@/components/theme-provider";
import { getCurrentUser, logout } from "@/lib/auth";

interface TopbarProps {
  onMenuToggle: () => void;
}

export default function Topbar({ onMenuToggle }: TopbarProps) {
  const { theme, setTheme } = useTheme();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const user = getCurrentUser();
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

        <button className="relative rounded-md p-2 text-muted-foreground hover:bg-accent" data-testid="notifications-btn">
          <Bell className="h-4 w-4" />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-destructive" />
        </button>

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
                    logout();
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
