import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { BarChart3, Loader2, MessageSquareMore, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  api,
  type ChannelRuntimeStatus,
  type CommercialPrincipal,
  type DataSourceSettings,
  type LLMSettings,
} from "@/lib/api";
import { getApiAuthKey, setApiAuthKey } from "@/lib/apiAuth";
import { cn } from "@/lib/utils";
import { ChannelsSettingsPanel } from "@/pages/settings/ChannelsSettingsPanel";
import { DataSourceSettingsPanel } from "@/pages/settings/DataSourceSettingsPanel";
import { OrganizationSecurityPanel } from "@/pages/settings/OrganizationSecurityPanel";
import { SettingsOverviewPanel } from "@/pages/settings/SettingsOverviewPanel";

type SettingsSection = "overview" | "data" | "security" | "channels";

const SETTINGS_SECTIONS: Array<{
  id: SettingsSection;
  icon: typeof BarChart3;
  labelKey: string;
  descKey: string;
}> = [
  { id: "overview", icon: BarChart3, labelKey: "settings.nav.overview", descKey: "settings.navDesc.overview" },
  { id: "data", icon: SlidersHorizontal, labelKey: "settings.nav.data", descKey: "settings.navDesc.data" },
  { id: "security", icon: ShieldCheck, labelKey: "settings.nav.security", descKey: "settings.navDesc.security" },
  { id: "channels", icon: MessageSquareMore, labelKey: "settings.nav.channels", descKey: "settings.navDesc.channels" },
];

function isSettingsSection(value: string | null): value is SettingsSection {
  return SETTINGS_SECTIONS.some((section) => section.id === value);
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function Settings() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = searchParams.get("section");
  const activeSection: SettingsSection = isSettingsSection(requestedSection) ? requestedSection : "overview";
  const [settings, setSettings] = useState<LLMSettings | null>(null);
  const [dataSettings, setDataSettings] = useState<DataSourceSettings | null>(null);
  const [principal, setPrincipal] = useState<CommercialPrincipal | null>(null);
  const [channelStatus, setChannelStatus] = useState<ChannelRuntimeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErrors, setLoadErrors] = useState<Record<string, string>>({});
  const [localApiKey, setLocalApiKeyState] = useState(() => getApiAuthKey());
  const [tushareToken, setTushareToken] = useState("");
  const [clearTushareToken, setClearTushareToken] = useState(false);
  const [dataSaving, setDataSaving] = useState(false);
  const [channelRefreshing, setChannelRefreshing] = useState(false);
  const [channelAction, setChannelAction] = useState<"start" | "stop" | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.allSettled([
      api.getLLMSettings(),
      api.getDataSourceSettings(),
      api.getChannelStatus(),
      api.getCommercialMe(),
    ]).then(([llmResult, dataResult, channelResult, principalResult]) => {
      if (!alive) return;
      const errors: Record<string, string> = {};
      if (llmResult.status === "fulfilled") setSettings(llmResult.value);
      else errors.overview = errorMessage(llmResult.reason, t("settings.unknownError"));

      if (dataResult.status === "fulfilled") setDataSettings(dataResult.value);
      else errors.data = errorMessage(dataResult.reason, t("settings.unknownError"));

      if (channelResult.status === "fulfilled") setChannelStatus(channelResult.value);
      else errors.channels = errorMessage(channelResult.reason, t("settings.unknownError"));

      setPrincipal(principalResult.status === "fulfilled" ? principalResult.value : null);
      setLoadErrors(errors);
    }).finally(() => {
      if (alive) setLoading(false);
    });
    return () => { alive = false; };
  }, [t]);

  const setSection = (section: SettingsSection) => {
    const next = new URLSearchParams(searchParams);
    next.set("section", section);
    setSearchParams(next, { replace: true });
  };

  const submitLocalApiKey = (event: FormEvent) => {
    event.preventDefault();
    setApiAuthKey(localApiKey);
    toast.success(t("settings.localApiKeySaved"));
    window.location.reload();
  };

  const submitDataSources = async (event: FormEvent) => {
    event.preventDefault();
    setDataSaving(true);
    try {
      const updated = await api.updateDataSourceSettings({
        tushare_token: tushareToken.trim() || undefined,
        clear_tushare_token: clearTushareToken,
      });
      setDataSettings(updated);
      setTushareToken("");
      setClearTushareToken(false);
      toast.success(t("settings.dataSourceSettingsSaved"));
    } catch (error) {
      toast.error(t("settings.saveDataSourceSettingsFailed", { message: errorMessage(error, t("settings.unknownError")) }));
    } finally {
      setDataSaving(false);
    }
  };

  const refreshChannelStatus = async () => {
    setChannelRefreshing(true);
    try {
      setChannelStatus(await api.getChannelStatus());
      setLoadErrors((current) => {
        const next = { ...current };
        delete next.channels;
        return next;
      });
    } catch (error) {
      const message = errorMessage(error, t("settings.unknownError"));
      setLoadErrors((current) => ({ ...current, channels: message }));
      toast.error(t("settings.channels.refreshFailedWithMessage", { message }));
    } finally {
      setChannelRefreshing(false);
    }
  };

  const setChannelsRunning = async (action: "start" | "stop") => {
    setChannelAction(action);
    try {
      const updated = action === "start" ? await api.startChannels() : await api.stopChannels();
      setChannelStatus(updated);
      toast.success(action === "start" ? t("settings.channels.started") : t("settings.channels.stoppedToast"));
    } catch (error) {
      const message = errorMessage(error, t("settings.unknownError"));
      toast.error(action === "start"
        ? t("settings.channels.startFailedWithMessage", { message })
        : t("settings.channels.stopFailedWithMessage", { message }));
    } finally {
      setChannelAction(null);
    }
  };

  const renderActiveSection = () => {
    if (activeSection === "overview") {
      return (
        <SettingsOverviewPanel
          modelName={settings?.model_name}
          provider={settings?.provider}
          documentCount={0}
          channelsRunning={Boolean(channelStatus?.running)}
        />
      );
    }
    if (activeSection === "data") {
      if (!dataSettings) return <Unavailable message={loadErrors.data || t("settings.unavailable")} />;
      return (
        <DataSourceSettingsPanel
          dataSettings={dataSettings}
          tushareToken={tushareToken}
          clearTushareToken={clearTushareToken}
          saving={dataSaving}
          tushareStatus={dataSettings.tushare_token_configured ? t("settings.configured") : t("settings.keepCurrentToken")}
          onSubmit={submitDataSources}
          onTushareTokenChange={setTushareToken}
          onClearTushareTokenChange={(checked) => {
            setClearTushareToken(checked);
            if (checked) setTushareToken("");
          }}
        />
      );
    }
    if (activeSection === "security") {
      return (
        <OrganizationSecurityPanel
          principal={principal}
          localApiKey={localApiKey}
          onLocalApiKeyChange={setLocalApiKeyState}
          onSubmitLocalApiKey={submitLocalApiKey}
        />
      );
    }
    return (
      <ChannelsSettingsPanel
        channelStatus={channelStatus}
        loadError={loadErrors.channels || ""}
        refreshing={channelRefreshing}
        action={channelAction}
        onRefresh={refreshChannelStatus}
        onSetRunning={setChannelsRunning}
      />
    );
  };

  const activeMeta = SETTINGS_SECTIONS.find((section) => section.id === activeSection) || SETTINGS_SECTIONS[0];
  const ActiveIcon = activeMeta.icon;
  const tr = (key: string) => t(key as never);

  return (
    <div data-page-enter className="mx-auto max-w-7xl p-4 sm:p-6">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold text-ink-strong">{t("settings.title")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">{t("settings.subtitle")}</p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="h-fit rounded-lg border border-[hsl(var(--border-subtle))] bg-surface-1 p-2 shadow-xs">
          <nav className="grid gap-1 sm:grid-cols-2 lg:grid-cols-1" aria-label={t("settings.title")}>
            {SETTINGS_SECTIONS.map(({ id, icon: Icon, labelKey, descKey }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                className={cn(
                  "relative flex min-h-14 w-full items-start gap-3 rounded-md px-3 py-2.5 text-left",
                  "transition-[color,background-color,transform] duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 active:translate-y-px",
                  activeSection === id ? "bg-primary/10 text-primary" : "text-ink-muted hover:bg-surface-2 hover:text-ink-strong",
                )}
              >
                {activeSection === id ? <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary rtl:left-auto rtl:right-0" /> : null}
                <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{tr(labelKey)}</span>
                  <span className="mt-0.5 block text-xs opacity-80">{tr(descKey)}</span>
                </span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="min-w-0">
          <div className="mb-4 flex min-h-16 items-start gap-3 border-b border-[hsl(var(--border-subtle))] pb-4">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
              <ActiveIcon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-ink-strong">{tr(activeMeta.labelKey)}</h2>
              <p className="mt-0.5 text-sm text-ink-muted">{tr(activeMeta.descKey)}</p>
              {loading ? (
                <span className="mt-2 inline-flex items-center gap-2 text-xs text-ink-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t("settings.loading")}
                </span>
              ) : null}
            </div>
          </div>
          {renderActiveSection()}
        </main>
      </div>
    </div>
  );
}

function Unavailable({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-[hsl(var(--border-subtle))] bg-surface-1 px-4 py-10 text-center text-sm text-ink-muted">
      {message}
    </div>
  );
}
