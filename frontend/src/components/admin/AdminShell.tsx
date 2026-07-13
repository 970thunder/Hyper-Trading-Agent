import { Activity, Bot, Cpu, Database, Gauge, LayoutDashboard, ReceiptText, UsersRound, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/utils";

type AdminNavigationKey = "overview" | "users" | "models" | "agents" | "knowledge" | "runtime" | "audit" | "usage";
type AdminNavigationItem = { path: string; key: AdminNavigationKey; icon: LucideIcon; exact?: boolean };

const ADMIN_ITEMS: AdminNavigationItem[] = [
  { path: "/admin", key: "overview", icon: LayoutDashboard, exact: true },
  { path: "/admin/users", key: "users", icon: UsersRound },
  { path: "/admin/models", key: "models", icon: Cpu },
  { path: "/admin/agents", key: "agents", icon: Bot },
  { path: "/admin/knowledge", key: "knowledge", icon: Database },
  { path: "/admin/runtime", key: "runtime", icon: Activity },
  { path: "/admin/audit", key: "audit", icon: ReceiptText },
  { path: "/admin/usage", key: "usage", icon: Gauge },
];

export function AdminShell() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const activePath = ADMIN_ITEMS.find((item) => item.exact ? location.pathname === item.path : location.pathname.startsWith(item.path))?.path || "/admin";

  return (
    <div data-page-enter className="mx-auto w-full max-w-[1600px] px-3 py-3 sm:px-4 sm:py-4 lg:px-5">
      <header className="mb-4 border-b border-[hsl(var(--border-subtle))] pb-4">
        <div className="flex items-center gap-2 text-xs font-medium text-primary">
          <Gauge className="h-4 w-4" aria-hidden="true" />
          {t("adminCenter.productLabel")}
        </div>
        <h1 className="mt-1.5 text-2xl font-semibold text-ink-strong">{t("adminCenter.title")}</h1>
        <p className="mt-1 max-w-3xl text-sm leading-5 text-ink-muted">{t("adminCenter.description")}</p>
      </header>

      <div className="mb-3 lg:hidden">
        <Select
          value={activePath}
          onValueChange={(value) => navigate(value)}
          label={t("adminCenter.navigation")}
          options={ADMIN_ITEMS.map((item) => ({ value: item.path, label: t(`adminCenter.nav.${item.key}`) }))}
          className="w-full"
        />
      </div>

      <div className="grid min-h-[calc(100dvh-12rem)] gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden border-e border-[hsl(var(--border-subtle))] pe-3 lg:block">
          <nav aria-label={t("adminCenter.navigation")} className="sticky top-4 grid gap-1">
            {ADMIN_ITEMS.map(({ path, key, icon: Icon, exact }) => (
              <NavLink
                key={path}
                to={path}
                end={exact}
                className={({ isActive }) => cn(
                  "relative flex min-h-9 items-center gap-2.5 rounded-md px-3 text-sm font-medium",
                  "transition-[color,background-color] duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                  isActive ? "bg-primary/10 text-primary" : "text-ink-muted hover:bg-surface-2 hover:text-ink-strong",
                )}
              >
                {({ isActive }) => (
                  <>
                    <span className={cn("absolute inset-y-1.5 start-0 w-0.5 rounded-e-full bg-primary transition-opacity duration-fast", isActive ? "opacity-100" : "opacity-0")} />
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{t(`adminCenter.nav.${key}`)}</span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>
        </aside>
        <main className="min-w-0"><Outlet /></main>
      </div>
    </div>
  );
}
