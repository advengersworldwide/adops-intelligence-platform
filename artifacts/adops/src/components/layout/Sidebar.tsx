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
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SidebarProps {
  open: boolean;
  onToggle: () => void;
}

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/platforms", label: "Platforms", icon: Monitor },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
  { href: "/upload", label: "Upload Data", icon: Upload },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function Sidebar({ open, onToggle }: SidebarProps) {
  const [location] = useLocation();

  return (
    <aside
      className={cn(
        "relative flex flex-col border-r border-border bg-sidebar transition-all duration-300 ease-in-out",
        open ? "w-56" : "w-16"
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
        {navItems.map(({ href, label, icon: Icon }) => {
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

      {/* Toggle btn */}
      <button
        onClick={onToggle}
        className="absolute -right-3 top-20 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm hover:bg-accent hover:text-accent-foreground"
        data-testid="sidebar-toggle"
      >
        {open ? <ChevronLeft className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
      </button>

      {/* Bottom section */}
      <div className="border-t border-border p-3">
        <div
          className={cn(
            "flex items-center gap-3 rounded-lg px-2 py-2",
            !open && "justify-center"
          )}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-bold">
            A
          </div>
          {open && (
            <div className="overflow-hidden">
              <p className="truncate text-xs font-semibold text-sidebar-foreground">Admin User</p>
              <p className="truncate text-[10px] text-muted-foreground">admin@adops.io</p>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
