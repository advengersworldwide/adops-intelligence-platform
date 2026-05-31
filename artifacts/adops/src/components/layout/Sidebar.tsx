import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Users,
  Monitor,
  Megaphone,
  ArrowLeftRight,
  Upload,
  BarChart3,
  Settings,
  ChevronLeft,
  ChevronRight,
  Zap,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getCurrentUser, hasPermission, logout } from "@/lib/auth";

interface SidebarProps {
  open: boolean;
  onToggle: () => void;
}

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, permission: "View Dashboard" },
  { href: "/clients", label: "Clients", icon: Users, permission: "View Clients" },
  { href: "/platforms", label: "Platforms", icon: Monitor, permission: "View Platforms" },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone, permission: "View Campaigns" },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight, permission: "View Transactions" },
  { href: "/upload", label: "Upload Data", icon: Upload, permission: "Upload Data" },
  { href: "/analytics", label: "Analytics", icon: BarChart3, permission: "View Analytics" },
  { href: "/settings", label: "Settings", icon: Settings, permission: "Manage Settings" },
];

export default function Sidebar({ open, onToggle }: SidebarProps) {
  const [location] = useLocation();
  const user = getCurrentUser();
  const userInitials = user?.name
    ? user.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)
    : "U";

  // Filter items based on permissions
  const filteredItems = navItems.filter(item => hasPermission(item.permission));

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-50 flex flex-col border-r border-border bg-sidebar transition-all duration-300 ease-in-out overflow-hidden",
        "md:relative md:translate-x-0",
        open
          ? "w-56 translate-x-0"
          : "w-0 -translate-x-full border-r-0 md:w-16 md:translate-x-0 md:border-r"
      )}
    >
      {/* Logo */}
      <div className="flex h-16 items-center border-b border-border px-4">
        <div className="flex items-center gap-2.5 overflow-hidden">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary">
            <Zap className="h-4 w-4 text-primary-foreground" />
          </div>
          {open && (
            <div className="overflow-hidden">
              <p className="truncate text-sm font-bold text-sidebar-foreground">AdOps</p>
              <p className="truncate text-[10px] text-muted-foreground">Intelligence Platform</p>
            </div>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {filteredItems.map(({ href, label, icon: Icon }) => {
          const isActive = href === "/" ? location === "/" : location.startsWith(href);
          return (
            <Link key={href} href={href}>
              <div
                data-testid={`nav-${label.toLowerCase().replace(/\s+/g, "-")}`}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-150",
                  isActive
                    ? "bg-sidebar-primary/10 text-sidebar-primary"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {open && <span className="truncate">{label}</span>}
              </div>
            </Link>
          );
        })}
      </nav>


      {/* Bottom section */}
      <div className="border-t border-border p-3 space-y-1.5">
        <div
          className={cn(
            "flex items-center gap-3 rounded-lg px-2 py-2 overflow-hidden",
            !open && "justify-center"
          )}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-bold">
            {userInitials}
          </div>
          {open && (
            <div className="overflow-hidden flex-1 min-w-0">
              <p className="truncate text-xs font-semibold text-sidebar-foreground">{user?.name || "Guest"}</p>
              <p className="truncate text-[10px] text-muted-foreground">{user?.email || ""}</p>
            </div>
          )}
        </div>
        
        <button
          onClick={logout}
          data-testid="logout-btn"
          className={cn(
            "flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors",
            !open && "justify-center"
          )}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {open && <span className="truncate">Log Out</span>}
        </button>
      </div>
    </aside>
  );
}
