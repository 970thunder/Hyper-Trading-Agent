import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Outlet, useLocation, useSearchParams } from "react-router-dom";
import {
  Activity,
  BarChart3,
  Bot,
  ChevronsLeft,
  ChevronsRight,
  Database,
  FileText,
  Layers,
  ServerCog,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { api, type CommercialPrincipal, type SessionItem } from "@/lib/api";
import { useDarkMode } from "@/hooks/useDarkMode";
import { useAgentStore } from "@/stores/agent";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/layout/AppShell";
import { ConnectionBanner } from "@/components/layout/ConnectionBanner";
import { PrimaryNavigation, type NavigationGroup, type NavigationItem } from "@/components/layout/PrimaryNavigation";
import { SessionRail, type SessionRailLabels } from "@/components/layout/SessionRail";
import { AccountMenu, type AccountMenuLabels } from "@/components/layout/AccountMenu";
import { MobileHeader, MobileNavigation } from "@/components/layout/MobileNavigation";
import { Drawer } from "@/components/ui/Drawer";
import { IconButton } from "@/components/ui/Button";

type Role = CommercialPrincipal["role"];
type GatedNavigationItem = NavigationItem & { roles?: Role[]; platformOnly?: boolean };

function visibleItems(items: GatedNavigationItem[], principal: CommercialPrincipal | null): NavigationItem[] {
  return items
    .filter((item) => (!item.roles || Boolean(principal && item.roles.includes(principal.role))) && (!item.platformOnly || Boolean(principal?.is_platform_admin)))
    .map(({ roles: _roles, platformOnly: _platformOnly, ...item }) => item);
}

export function Layout() {
  const { t, i18n } = useTranslation();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const { dark, toggle } = useDarkMode();
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [principal, setPrincipal] = useState<CommercialPrincipal | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [mobileSessionsOpen, setMobileSessionsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("qa-sidebar") === "collapsed");
  const sseStatus = useAgentStore((state) => state.sseStatus);
  const sseRetryAttempt = useAgentStore((state) => state.sseRetryAttempt);
  const streamingSessionId = useAgentStore((state) => state.streamingSessionId);
  const activeSessionId = searchParams.get("session");
  const isAgentPage = pathname.startsWith("/agent");
  const drawerSide = i18n.dir() === "rtl" ? "right" : "left";

  useEffect(() => {
    localStorage.setItem("qa-sidebar", collapsed ? "collapsed" : "expanded");
  }, [collapsed]);

  useEffect(() => {
    setMobileNavigationOpen(false);
    setMobileSessionsOpen(false);
  }, [pathname]);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const list = await api.listSessions();
      setSessions(Array.isArray(list) ? list : []);
    } catch {
      setSessions([]);
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAgentPage) void loadSessions();
  }, [activeSessionId, isAgentPage, loadSessions]);

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

  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await api.logoutCommercial();
      setPrincipal(null);
      window.location.reload();
    } catch {
      toast.error(t("layout.logoutFailed"));
      setLoggingOut(false);
    }
  };

  const deleteSession = async (sessionId: string) => {
    try {
      await api.deleteSession(sessionId);
      setSessions((current) => current.filter((session) => session.session_id !== sessionId));
    } catch {
      // The list remains unchanged so the user can retry the action.
    }
  };

  const renameSession = async (sessionId: string, title: string) => {
    try {
      await api.renameSession(sessionId, title);
      setSessions((current) => current.map((session) => (
        session.session_id === sessionId ? { ...session, title } : session
      )));
    } catch {
      // Keep the server-backed title when rename fails.
    }
  };

  const navigationGroups = useMemo<NavigationGroup[]>(() => {
    const groups: Array<{ id: string; label: string; items: GatedNavigationItem[] }> = [
      {
        id: "workspace",
        label: t("layout.workspaceGroup"),
        items: [
          { to: "/agent", icon: Bot, label: t("layout.agent") },
          { to: "/runtime", icon: Activity, label: t("layout.runtime"), roles: ["owner", "admin"] },
          { to: "/reports", icon: FileText, label: t("layout.reports") },
        ],
      },
      {
        id: "research",
        label: t("layout.researchGroup"),
        items: [
          { to: "/knowledge", icon: Database, label: t("settings.nav.knowledge"), roles: ["owner", "admin", "member", "viewer"] },
          { to: "/alpha-zoo", icon: Layers, label: t("layout.alphaZoo") },
          { to: "/correlation", icon: BarChart3, label: t("layout.correlation") },
        ],
      },
      {
        id: "administration",
        label: t("layout.administrationGroup"),
        items: [
          { to: "/admin", icon: ShieldCheck, label: t("layout.admin"), roles: ["owner", "admin"] },
          { to: "/platform", icon: ServerCog, label: t("layout.platform"), platformOnly: true },
        ],
      },
    ];
    return groups
      .map((group) => ({ ...group, items: visibleItems(group.items, principal) }))
      .filter((group) => group.items.length > 0);
  }, [principal, t]);

  const sessionLabels: SessionRailLabels = {
    title: t("layout.sessions"),
    newChat: t("layout.newChat"),
    empty: t("layout.noSessions"),
    rename: t("layout.rename"),
    delete: t("layout.delete"),
    confirm: t("layout.confirm"),
    cancel: t("layout.cancel"),
  };

  const accountLabels: AccountMenuLabels = {
    account: t("layout.account"),
    login: t("layout.login"),
    logout: t("layout.logout"),
    light: t("layout.light"),
    dark: t("layout.dark"),
    language: t("layout.language"),
    settings: t("layout.settings"),
  };

  const accountMenu = (compact: boolean, side: "top" | "bottom") => (
    <AccountMenu
      principal={principal}
      dark={dark}
      currentLanguage={i18n.language}
      loggingOut={loggingOut}
      labels={accountLabels}
      onToggleTheme={toggle}
      onLanguageChange={(language) => { void i18n.changeLanguage(language); }}
      onLogout={() => { void logout(); }}
      version={t("app.version")}
      collapsed={compact}
      side={side}
    />
  );

  const sessionRail = (
    <SessionRail
      sessions={sessions}
      activeSessionId={activeSessionId}
      streamingSessionId={streamingSessionId}
      loading={sessionsLoading}
      labels={sessionLabels}
      onRename={renameSession}
      onDelete={deleteSession}
      onNavigate={() => setMobileSessionsOpen(false)}
    />
  );

  const desktopSidebar = (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden border-e border-[hsl(var(--border-subtle))] bg-surface-1",
        "transition-[width] duration-base ease-emphasized",
        collapsed ? "w-[var(--sidebar-width-collapsed)]" : "w-[var(--sidebar-width)]",
      )}
    >
      <div className={cn("h-14 shrink-0 items-center border-b border-[hsl(var(--border-subtle))]", collapsed ? "grid grid-cols-2" : "flex gap-1 px-3")}>
        <Link to="/" aria-label="Hyper Trading Agent" className={cn("brand-header flex min-w-0 items-center gap-2", collapsed && "h-full w-full justify-center")}>
          <span className="brand-mark"><BarChart3 className="h-4 w-4" aria-hidden="true" /></span>
          {!collapsed ? <span className="brand-title truncate">Hyper Trading Agent</span> : null}
        </Link>
        <IconButton
          label={collapsed ? t("layout.expand") : t("layout.collapse")}
          onClick={() => setCollapsed((value) => !value)}
          className={cn("h-8 shrink-0", collapsed ? "w-8 justify-self-center" : "ms-auto w-8")}
        >
          {collapsed ? <ChevronsRight className="h-3.5 w-3.5 rtl:flip-x" /> : <ChevronsLeft className="h-3.5 w-3.5 rtl:flip-x" />}
        </IconButton>
      </div>

      <div className={cn("min-h-0 overflow-y-auto", isAgentPage && !collapsed ? "max-h-[38%] shrink-0" : "flex-1")}>
        <PrimaryNavigation groups={navigationGroups} pathname={pathname} collapsed={collapsed} ariaLabel={t("layout.primaryNavigation")} />
      </div>

      {!collapsed && isAgentPage ? sessionRail : null}

      <div className={cn("shrink-0 border-t border-[hsl(var(--border-subtle))]", collapsed ? "grid justify-items-center gap-1 p-1.5" : "grid gap-2 p-2.5")}>
        {accountMenu(collapsed, "top")}
      </div>
    </div>
  );

  const mobileHeader = (
    <MobileHeader
      navigationLabel={t("layout.openNavigation")}
      onOpenNavigation={() => setMobileNavigationOpen(true)}
      sessionsLabel={isAgentPage ? t("layout.openSessions") : undefined}
      onOpenSessions={isAgentPage ? () => setMobileSessionsOpen(true) : undefined}
      trailing={accountMenu(true, "bottom")}
    />
  );

  return (
    <>
      <AppShell
        desktopSidebar={desktopSidebar}
        mobileHeader={mobileHeader}
        banner={<ConnectionBanner status={sseStatus} retryAttempt={sseRetryAttempt} />}
      >
        <Outlet />
      </AppShell>

      <MobileNavigation
        open={mobileNavigationOpen}
        onOpenChange={setMobileNavigationOpen}
        groups={navigationGroups}
        pathname={pathname}
        title={t("layout.navigation")}
        closeLabel={t("layout.closeNavigation")}
        navigationLabel={t("layout.primaryNavigation")}
        side={drawerSide}
      />

      <Drawer
        open={mobileSessionsOpen}
        onOpenChange={setMobileSessionsOpen}
        title={t("layout.sessions")}
        closeLabel={t("layout.closeSessions")}
        side={drawerSide}
        className="w-[min(20rem,calc(100vw-2rem))]"
      >
        <div className="flex h-full min-h-0 flex-col">{sessionRail}</div>
      </Drawer>
    </>
  );
}
