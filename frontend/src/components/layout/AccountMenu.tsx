import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronDown, Languages, Loader2, LogIn, LogOut, Moon, Settings, Sun, UserRound } from "lucide-react";
import type { CommercialPrincipal } from "@/lib/api";
import { SUPPORTED_LANGUAGES, type SupportedLanguageCode } from "@/i18n";
import { cn } from "@/lib/utils";
import { FloatingLayer, type FloatingSide } from "@/components/ui/FloatingLayer";

export interface AccountMenuLabels {
  account: string;
  login: string;
  logout: string;
  light: string;
  dark: string;
  language: string;
  settings?: string;
}

export interface AccountMenuProps {
  principal: CommercialPrincipal | null;
  dark: boolean;
  currentLanguage: string;
  loggingOut: boolean;
  labels: AccountMenuLabels;
  onToggleTheme: () => void;
  onLanguageChange: (language: SupportedLanguageCode) => void;
  onLogout: () => void;
  version: string;
  collapsed?: boolean;
  side?: FloatingSide;
  className?: string;
}

export function AccountMenu({
  principal,
  dark,
  currentLanguage,
  loggingOut,
  labels,
  onToggleTheme,
  onLanguageChange,
  onLogout,
  version,
  collapsed = false,
  side = "top",
  className,
}: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const current = SUPPORTED_LANGUAGES.find((language) => language.code === currentLanguage)
    || SUPPORTED_LANGUAGES.find((language) => currentLanguage.startsWith(language.code))
    || SUPPORTED_LANGUAGES[0];
  const identity = principal?.email || labels.login;

  return (
    <FloatingLayer
      open={open}
      onOpenChange={setOpen}
      trigger={(
        <button
          type="button"
          aria-label={`${labels.account}: ${identity}`}
          className={cn(
            "flex h-10 min-w-0 items-center rounded-md border border-[hsl(var(--border-subtle))] bg-surface-1 text-left shadow-xs",
            "transition-[color,background-color,border-color,box-shadow] duration-fast ease-standard hover:border-border hover:bg-surface-2 hover:shadow-sm",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
            collapsed ? "w-10 justify-center" : "w-full gap-2 px-2.5",
            className,
          )}
        >
          <UserRound className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          {!collapsed ? (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-ink-strong">{identity}</span>
                <span className="block truncate text-[11px] leading-4 text-ink-muted">{principal?.role || labels.account}</span>
              </span>
              <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-ink-muted transition-transform duration-fast", open && "rotate-180")} aria-hidden="true" />
            </>
          ) : null}
        </button>
      )}
      contentLabel={labels.account}
      role="menu"
      side={side}
      align="start"
      autoFocus="first"
      className="w-64 p-1.5"
    >
      <div className="mb-1 flex items-start gap-2 border-b border-[hsl(var(--border-subtle))] px-2.5 py-2">
        {principal ? (
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-ink-strong" title={principal.email}>{principal.email}</div>
            <div className="mt-0.5 text-xs capitalize text-ink-muted">{principal.role}</div>
          </div>
        ) : <span className="flex-1" />}
        <Link
          to="/settings"
          role="menuitem"
          aria-label={labels.settings || labels.account}
          title={labels.settings || labels.account}
          onClick={() => setOpen(false)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-muted transition-colors duration-fast hover:bg-surface-2 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
        >
          <Settings className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>

      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onToggleTheme();
          setOpen(false);
        }}
        className="flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-sm text-ink transition-colors duration-fast hover:bg-surface-2 hover:text-ink-strong"
      >
        {dark ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
        <span>{dark ? labels.light : labels.dark}</span>
      </button>

      <div className="my-1 border-t border-[hsl(var(--border-subtle))]" />
      <div className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-medium text-ink-muted">
        <Languages className="h-3.5 w-3.5" aria-hidden="true" />
        {labels.language}
      </div>
      {SUPPORTED_LANGUAGES.map((language) => {
        const active = language.code === current.code;
        return (
          <button
            key={language.code}
            type="button"
            role="menuitem"
            aria-current={active || undefined}
            onClick={() => {
              onLanguageChange(language.code);
              setOpen(false);
            }}
            className={cn(
              "flex min-h-8 w-full items-center gap-2 rounded-md px-2.5 text-sm transition-colors duration-fast",
              active ? "bg-primary/10 text-primary" : "text-ink hover:bg-surface-2 hover:text-ink-strong",
            )}
          >
            <span className="min-w-0 flex-1 text-start">{language.label}</span>
            {active ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
          </button>
        );
      })}

      <div className="my-1 border-t border-[hsl(var(--border-subtle))]" />
      {principal ? (
        <button
          type="button"
          role="menuitem"
          disabled={loggingOut}
          onClick={() => {
            onLogout();
            setOpen(false);
          }}
          className="flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-sm text-danger transition-colors duration-fast hover:bg-danger/10 disabled:opacity-45"
        >
          {loggingOut ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <LogOut className="h-4 w-4" aria-hidden="true" />}
          {labels.logout}
        </button>
      ) : (
        <Link to="/login" role="menuitem" onClick={() => setOpen(false)} className="flex min-h-9 items-center gap-2.5 rounded-md px-2.5 text-sm text-ink transition-colors duration-fast hover:bg-surface-2 hover:text-ink-strong">
          <LogIn className="h-4 w-4" aria-hidden="true" />
          {labels.login}
        </Link>
      )}
      <div className="px-2.5 pt-1.5 text-[10px] text-ink-disabled">{version}</div>
    </FloatingLayer>
  );
}
