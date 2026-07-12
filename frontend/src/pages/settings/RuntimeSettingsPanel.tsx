import { Activity } from "lucide-react";
import { useTranslation } from "react-i18next";

const sectionCardClass = "rounded-lg border border-border/70 bg-card p-5 shadow-sm";

export function RuntimeSettingsPanel() {
  const { t } = useTranslation();

  return (
    <section className={sectionCardClass}>
      <div className="mb-5 flex items-center gap-2">
        <Activity className="h-4 w-4 text-primary" />
        <h2 className="text-base font-semibold">{t("settings.jobs.title")}</h2>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard label={t("settings.jobs.agentRuns")} value={t("settings.jobs.currentMode")} />
        <MetricCard label={t("settings.jobs.ragIngestion")} value={t("settings.jobs.planned")} />
        <MetricCard label={t("settings.jobs.worker")} value={t("settings.jobs.dockerReady")} />
      </div>
      <p className="mt-4 text-sm text-muted-foreground">{t("settings.jobs.description")}</p>
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
