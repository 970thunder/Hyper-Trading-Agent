import { ClipboardList, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { AuditLog, ModelUsage } from "@/lib/api";

const sectionCardClass = "rounded-lg border border-border/70 bg-card p-5 shadow-sm";

interface AuditUsagePanelProps {
  auditLogs: AuditLog[];
  modelUsage: ModelUsage[];
  onRefresh: () => Promise<void>;
}

export function AuditUsagePanel({ auditLogs, modelUsage, onRefresh }: AuditUsagePanelProps) {
  const { t } = useTranslation();
  const totalTokens = modelUsage.reduce((sum, item) => sum + (item.total_tokens || 0), 0);
  const totalCost = modelUsage.reduce((sum, item) => sum + (item.estimated_cost || 0), 0);
  const usageByDate = modelUsage.reduce<Record<string, number>>((acc, item) => {
    const date = item.created_at.slice(0, 10);
    acc[date] = (acc[date] || 0) + (item.total_tokens || 0);
    return acc;
  }, {});
  const usageBars = Object.entries(usageByDate).sort(([a], [b]) => a.localeCompare(b)).slice(-7);
  const maxUsageBar = Math.max(1, ...usageBars.map(([, value]) => value));

  const refresh = () => {
    onRefresh().catch((error) => {
      toast.error(t("settings.audit.refreshFailed", { message: error instanceof Error ? error.message : t("settings.unknownError") }));
    });
  };

  return (
    <section className={sectionCardClass}>
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">{t("settings.audit.title")}</h2>
          </div>
          <p className="text-sm text-muted-foreground">{t("settings.audit.description")}</p>
        </div>
        <button type="button" onClick={refresh} className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground">
          <RefreshCw className="h-4 w-4" />
          {t("settings.refresh")}
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard label={t("settings.audit.modelCalls")} value={String(modelUsage.length)} />
        <MetricCard label={t("settings.audit.totalTokens")} value={String(totalTokens)} />
        <MetricCard label={t("settings.audit.estimatedCost")} value={totalCost.toFixed(4)} />
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="rounded-md border bg-muted/10 p-4">
          <h3 className="mb-3 text-sm font-semibold">{t("settings.audit.tokenTrend")}</h3>
          {usageBars.length ? (
            <div className="space-y-2">
              {usageBars.map(([date, value]) => (
                <div key={date} className="grid grid-cols-[88px_minmax(0,1fr)_72px] items-center gap-2 text-xs">
                  <span className="text-muted-foreground">{date}</span>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, (value / maxUsageBar) * 100)}%` }} />
                  </div>
                  <span className="text-right text-muted-foreground">{value}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-md border bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground">{t("settings.audit.noUsage")}</div>
          )}
        </div>
        <div className="overflow-hidden rounded-md border">
          <div className="border-b bg-muted/20 px-3 py-2 text-sm font-semibold">{t("settings.audit.modelUsage")}</div>
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">{t("settings.audit.time")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("settings.model")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("settings.audit.totalTokens")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("settings.audit.run")}</th>
              </tr>
            </thead>
            <tbody>
              {modelUsage.length ? modelUsage.slice(0, 8).map((usage) => (
                <tr key={usage.id} className="border-t">
                  <td className="whitespace-nowrap px-3 py-2 align-top text-xs text-muted-foreground">{usage.created_at.slice(0, 19).replace("T", " ")}</td>
                  <td className="px-3 py-2 align-top">
                    <div className="font-medium">{usage.provider}</div>
                    <div className="text-xs text-muted-foreground">{usage.model}</div>
                  </td>
                  <td className="px-3 py-2 text-right align-top tabular-nums">{usage.total_tokens}</td>
                  <td className="max-w-[160px] truncate px-3 py-2 align-top text-xs text-muted-foreground" title={usage.run_id || ""}>{usage.run_id || "-"}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-sm text-muted-foreground">{t("settings.audit.noUsage")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="overflow-hidden rounded-md border lg:col-span-2">
          <div className="border-b bg-muted/20 px-3 py-2 text-sm font-semibold">{t("settings.audit.auditLogs")}</div>
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">{t("settings.audit.time")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("settings.audit.action")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("settings.audit.target")}</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.length ? auditLogs.slice(0, 12).map((log) => (
                <tr key={log.id} className="border-t">
                  <td className="whitespace-nowrap px-3 py-2 align-top text-xs text-muted-foreground">{log.created_at.slice(0, 19).replace("T", " ")}</td>
                  <td className="px-3 py-2 align-top font-medium">{log.action}</td>
                  <td className="max-w-sm truncate px-3 py-2 align-top text-xs text-muted-foreground" title={`${log.target_type}:${log.target_id}`}>{log.target_type || "-"} {log.target_id}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={3} className="px-3 py-8 text-center text-sm text-muted-foreground">{t("settings.audit.noAuditLogs")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function MetricCard({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="rounded-md border bg-muted/20 p-4">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-2 truncate text-lg font-semibold" title={title ?? value}>{value}</div>
    </div>
  );
}
