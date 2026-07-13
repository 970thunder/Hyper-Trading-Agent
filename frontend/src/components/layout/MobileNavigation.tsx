import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { BarChart3, Menu, MessageSquare } from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
import { IconButton } from "@/components/ui/Button";
import { PrimaryNavigation, type NavigationGroup } from "@/components/layout/PrimaryNavigation";

export interface MobileNavigationProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: NavigationGroup[];
  pathname: string;
  title: string;
  closeLabel: string;
  footer?: ReactNode;
  side?: "left" | "right";
  navigationLabel?: string;
}

export function MobileNavigation({ open, onOpenChange, groups, pathname, title, closeLabel, footer, side = "left", navigationLabel }: MobileNavigationProps) {
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      closeLabel={closeLabel}
      side={side}
      footer={footer}
      className="w-[min(19rem,calc(100vw-2rem))]"
    >
      <PrimaryNavigation groups={groups} pathname={pathname} onNavigate={() => onOpenChange(false)} className="py-3" ariaLabel={navigationLabel} />
    </Drawer>
  );
}

export interface MobileHeaderProps {
  navigationLabel: string;
  onOpenNavigation: () => void;
  sessionsLabel?: string;
  onOpenSessions?: () => void;
  trailing?: ReactNode;
}

export function MobileHeader({ navigationLabel, onOpenNavigation, sessionsLabel, onOpenSessions, trailing }: MobileHeaderProps) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <IconButton label={navigationLabel} onClick={onOpenNavigation} className="h-9 w-9">
        <Menu className="h-4 w-4" />
      </IconButton>
      <Link to="/" className="flex min-w-0 flex-1 items-center gap-2 font-semibold text-ink-strong">
        <BarChart3 className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="truncate text-sm">Hyper Trading Agent</span>
      </Link>
      {sessionsLabel && onOpenSessions ? (
        <IconButton label={sessionsLabel} onClick={onOpenSessions} className="h-9 w-9">
          <MessageSquare className="h-4 w-4" />
        </IconButton>
      ) : null}
      {trailing}
    </div>
  );
}
