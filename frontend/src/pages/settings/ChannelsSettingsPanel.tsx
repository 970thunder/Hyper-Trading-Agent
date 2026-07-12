import { Loader2, MessageSquareMore, Play, RefreshCw, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ChannelRuntimeStatus } from "@/lib/api";

type ChannelAction = "start" | "stop" | null;

interface ChannelsSettingsPanelProps {
  channelStatus: ChannelRuntimeStatus | null;
  loadError: string;
  refreshing: boolean;
  action: ChannelAction;
  onRefresh: () => void;
  onSetRunning: (action: "start" | "stop") => void;
}

export function ChannelsSettingsPanel({
  channelStatus,
  loadError,
  refreshing,
  action,
  onRefresh,
  onSetRunning,
}: ChannelsSettingsPanelProps) {
  const { t } = useTranslation();
  const channelRows = channelStatus
    ? Object.entries(channelStatus.channels ?? {}).sort(([a], [b]) => a.localeCompare(b))
    : [];
  const channelEnabledCount = channelRows.filter(([, item]) => item.enabled).length;
  const channelLoadedCount = channelRows.filter(([, item]) => item.loaded).length;
  const channelUnavailableCount = channelRows.filter(([, item]) => item.available === false).length;
  const channelBusy = refreshing || action !== null;

  return (
    <section className="rounded-lg border border-border/70 bg-card p-5 shadow-sm">
      <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <MessageSquareMore className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">{t("settings.channels.title")}</h2>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">{t("settings.channels.description")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onRefresh} disabled={channelBusy} className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60">
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {t("settings.channels.refresh")}
          </button>
          <button type="button" onClick={() => onSetRunning("start")} disabled={channelBusy || !channelStatus} className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60">
            {action === "start" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {t("settings.channels.start")}
          </button>
          <button type="button" onClick={() => onSetRunning("stop")} disabled={channelBusy || !channelStatus} className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60">
            {action === "stop" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
            {t("settings.channels.stop")}
          </button>
        </div>
      </div>

      {channelStatus ? (
        <>
          <div className="mb-4 grid gap-3 md:grid-cols-4">
            <MetricCard label={t("settings.channels.runtime")} value={channelStatus.running ? t("settings.channels.running") : t("settings.channels.stopped")} />
            <MetricCard label={t("settings.channels.enabled")} value={String(channelEnabledCount)} />
            <MetricCard label={t("settings.channels.loaded")} value={String(channelLoadedCount)} />
            <MetricCard label={t("settings.channels.unavailable")} value={String(channelUnavailableCount)} />
          </div>
          <div className="mb-4 rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">
            <div className="font-medium text-foreground">{t("settings.channels.howToUseTitle")}</div>
            <p className="mt-1">{t("settings.channels.howToUseBody")}</p>
            <div className="mt-2 font-mono text-xs">/pairing approve &lt;code&gt; / /pairing list / /new</div>
          </div>
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">{t("settings.channels.channel")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("settings.channels.state")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("settings.channels.config")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("settings.channels.recovery")}</th>
                </tr>
              </thead>
              <tbody>
                {channelRows.map(([name, item]) => (
                  <tr key={name} className="border-t">
                    <td className="px-3 py-2 align-top">
                      <div className="font-medium">{item.display_name || name}</div>
                      <div className="text-xs text-muted-foreground">{name}</div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="flex flex-wrap gap-1.5">
                        <StatusPill active={item.enabled} on={t("settings.channels.enabled")} off={t("settings.channels.disabled")} />
                        <StatusPill active={item.loaded} on={t("settings.channels.loaded")} off={t("settings.channels.notLoaded")} />
                        <StatusPill active={item.running} on={t("settings.channels.running")} off={t("settings.channels.stopped")} />
                      </div>
                    </td>
                    <td className="max-w-xs px-3 py-2 align-top font-mono text-xs text-muted-foreground">
                      {channelConfigHint(name)}
                    </td>
                    <td className="max-w-md px-3 py-2 align-top text-xs text-muted-foreground">
                      {item.install_hint || item.error || t("settings.channels.noRecovery")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : unavailable(loadError || t("settings.channels.refreshFailed"))}
    </section>
  );
}

function channelConfigHint(name: string) {
  const key = name.toLowerCase();
  if (key === "telegram") return "channels.telegram.enabled / botToken / allowUsers";
  if (key === "discord") return "channels.discord.enabled / botToken / allowChannels";
  if (key === "feishu") return "channels.feishu.enabled / appId / appSecret";
  if (key === "dingtalk") return "channels.dingtalk.enabled / clientId / clientSecret";
  if (key === "email") return "channels.email.enabled / imapHost / smtpHost";
  if (key === "websocket") return "channels.websocket.enabled / host / port";
  if (key === "wecom") return "channels.wecom.enabled / clientId / clientSecret";
  if (key === "weixin") return "channels.weixin.enabled";
  if (key === "whatsapp") return "channels.whatsapp.enabled";
  if (key === "signal") return "channels.signal.enabled";
  return `channels.${key}.enabled`;
}

function unavailable(message: string) {
  return (
    <div className="rounded-lg border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function MetricCard({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-2 transition-colors hover:bg-muted/35">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="truncate text-sm font-medium" title={title || value}>{value}</div>
    </div>
  );
}

function StatusPill({ active, on, off }: { active: boolean; on: string; off: string }) {
  return (
    <span className={active ? "status-primary" : "status-soft"}>
      {active ? on : off}
    </span>
  );
}
