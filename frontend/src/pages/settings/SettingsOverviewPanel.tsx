import { useTranslation } from "react-i18next";

interface SettingsOverviewPanelProps {
  modelName?: string;
  provider?: string;
  documentCount: number;
  channelsRunning?: boolean;
}

export function SettingsOverviewPanel({
  modelName,
  provider,
  documentCount,
  channelsRunning = false,
}: SettingsOverviewPanelProps) {
  const { t } = useTranslation();
  return (
    <section className="rounded-lg border border-border/70 bg-card p-5 shadow-sm">
      <div className="mb-5 space-y-1">
        <h2 className="text-base font-semibold">{t("settings.overview.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("settings.overview.description")}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label={t("settings.overview.model")} value={modelName || t("settings.unavailable")} />
        <MetricCard label={t("settings.overview.provider")} value={provider || t("settings.unavailable")} />
        <MetricCard label={t("settings.overview.documents")} value={String(documentCount)} />
        <MetricCard
          label={t("settings.overview.channels")}
          value={channelsRunning ? t("settings.channels.running") : t("settings.channels.stopped")}
        />
      </div>
    </section>
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
