import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Moon, ServerCog, Sun } from "lucide-react";
import { toast, Toaster } from "sonner";
import { api, type CommercialPrincipal } from "@/lib/api";
import { useDarkMode } from "@/hooks/useDarkMode";
import { Button, IconButton } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

export function PlatformAdminShell({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { dark, toggle } = useDarkMode();
  const [principal, setPrincipal] = useState<CommercialPrincipal | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.getCommercialMe()
      .then((me) => {
        if (!cancelled) setPrincipal(me);
      })
      .catch(() => {
        if (!cancelled) setPrincipal(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const logout = useCallback(async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await api.logoutCommercial();
      window.location.replace("/login");
    } catch {
      toast.error(t("layout.logoutFailed"));
      setLoggingOut(false);
    }
  }, [loggingOut, t]);

  return (
    <div data-platform-admin-shell data-testid="platform-admin-shell" className="flex h-dvh min-h-0 w-full flex-col overflow-hidden bg-background text-ink-strong">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[hsl(var(--border-subtle))] bg-surface-1 px-3 sm:px-4 lg:px-5">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <ServerCog className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-xs font-medium text-primary">{t("settings.platformAdmin.productLabel")}</div>
            <div className="truncate text-sm font-semibold text-ink-strong">{t("settings.platformAdmin.title")}</div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {principal?.email ? (
            <span className="hidden max-w-[14rem] truncate text-xs text-ink-muted sm:inline" title={principal.email}>
              {principal.email}
            </span>
          ) : null}
          <IconButton
            label={dark ? t("layout.light") : t("layout.dark")}
            onClick={toggle}
            className="h-8 w-8"
          >
            {dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </IconButton>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/agent")}
            leftIcon={<ArrowLeft className="h-3.5 w-3.5" />}
            className="hidden sm:inline-flex"
          >
            {t("settings.platformAdmin.backToApp")}
          </Button>
          <Link
            to="/agent"
            className={cn(
              "inline-flex h-8 items-center justify-center rounded-md border border-border px-2 text-ink-strong sm:hidden",
              "transition-[color,background-color,border-color] duration-fast hover:bg-surface-2",
            )}
            aria-label={t("settings.platformAdmin.backToApp")}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </Link>
          <Button variant="ghost" size="sm" loading={loggingOut} onClick={() => void logout()}>
            {t("layout.logout")}
          </Button>
        </div>
      </header>

      <main className="min-h-0 min-w-0 flex-1 overflow-auto" dir={i18n.dir()}>
        {children}
      </main>

      <Toaster position="bottom-right" richColors closeButton duration={3500} />
    </div>
  );
}
