import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface AppShellProps {
  desktopSidebar: ReactNode;
  mobileHeader: ReactNode;
  banner?: ReactNode;
  children: ReactNode;
  className?: string;
  mainClassName?: string;
}

export function AppShell({ desktopSidebar, mobileHeader, banner, children, className, mainClassName }: AppShellProps) {
  return (
    <div data-app-shell className={cn("workspace-shell flex h-dvh min-h-0 w-full overflow-hidden text-ink-strong", className)}>
      <aside data-testid="desktop-sidebar" className="hidden h-full shrink-0 md:flex">
        {desktopSidebar}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header data-testid="mobile-header" className="flex h-[3.25rem] shrink-0 items-center border-b border-[hsl(var(--border-subtle))] bg-surface-1 px-3 md:hidden">
          {mobileHeader}
        </header>
        {banner}
        <main className={cn("min-h-0 min-w-0 flex-1 overflow-auto", mainClassName)}>
          {children}
        </main>
      </div>
    </div>
  );
}
