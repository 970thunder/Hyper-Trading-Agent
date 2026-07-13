import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface NavigationItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

export interface NavigationGroup {
  id: string;
  label?: string;
  items: NavigationItem[];
}

export interface PrimaryNavigationProps {
  groups: NavigationGroup[];
  pathname: string;
  collapsed?: boolean;
  onNavigate?: () => void;
  className?: string;
  ariaLabel?: string;
}

function isActiveRoute(pathname: string, target: string) {
  return target === "/" ? pathname === "/" : pathname === target || pathname.startsWith(`${target}/`);
}

export function PrimaryNavigation({ groups, pathname, collapsed = false, onNavigate, className, ariaLabel = "Primary" }: PrimaryNavigationProps) {
  return (
    <nav aria-label={ariaLabel} className={cn("grid gap-3", collapsed ? "px-1.5 py-2" : "px-2 py-3", className)}>
      {groups.map((group) => (
        <div key={group.id} className="grid gap-1">
          {!collapsed && group.label ? (
            <div className="px-2 pb-0.5 text-[11px] font-medium leading-4 text-ink-muted">{group.label}</div>
          ) : null}
          <div className="grid gap-0.5">
            {group.items.map(({ to, label, icon: Icon }) => {
              const active = isActiveRoute(pathname, to);
              return (
                <Link
                  key={to}
                  to={to}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  aria-label={collapsed ? label : undefined}
                  title={collapsed ? label : undefined}
                  className={cn(
                    "group relative flex min-h-9 items-center rounded-md text-sm font-medium",
                    "transition-[color,background-color] duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                    collapsed ? "justify-center px-2" : "gap-3 px-2.5",
                    active ? "bg-primary/10 text-primary" : "text-ink-muted hover:bg-surface-2 hover:text-ink-strong",
                  )}
                >
                  <span className={cn("absolute inset-y-1.5 start-0 w-0.5 rounded-e-full bg-primary transition-opacity duration-fast", active ? "opacity-100" : "opacity-0")} />
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {!collapsed ? <span className="min-w-0 flex-1 truncate">{label}</span> : null}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
