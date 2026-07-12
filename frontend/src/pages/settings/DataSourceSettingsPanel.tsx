import type { FormEvent } from "react";
import { Database, KeyRound, Loader2, Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DataSourceSettings } from "@/lib/api";
import { cn } from "@/lib/utils";

interface DataSourceSettingsPanelProps {
  dataSettings: DataSourceSettings;
  tushareToken: string;
  clearTushareToken: boolean;
  saving: boolean;
  tushareStatus: string;
  onSubmit: (event: FormEvent) => void;
  onTushareTokenChange: (value: string) => void;
  onClearTushareTokenChange: (value: boolean) => void;
}

const fieldClass =
  "w-full rounded-md border border-border/75 bg-background px-3 py-2 text-sm outline-none transition focus:border-primary/70 focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60";
const labelClass = "text-sm font-medium";
const hintClass = "text-xs text-muted-foreground";

export function DataSourceSettingsPanel({
  dataSettings,
  tushareToken,
  clearTushareToken,
  saving,
  tushareStatus,
  onSubmit,
  onTushareTokenChange,
  onClearTushareTokenChange,
}: DataSourceSettingsPanelProps) {
  const { t } = useTranslation();
  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-border/70 bg-card p-5 shadow-sm">
      <div className="mb-5 space-y-1">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold">{t("settings.dataSourceSettings")}</h2>
        </div>
        <p className="text-sm text-muted-foreground">{t("settings.dataSourceSettingsDesc")}</p>
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
        <div className="grid gap-4">
          <label className="grid gap-2">
            <span className={labelClass}>{t("settings.tushareToken")}</span>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <input type="password" value={tushareToken} onChange={(event) => onTushareTokenChange(event.target.value)} className={`${fieldClass} pl-9`} placeholder={tushareStatus} autoComplete="current-password" disabled={clearTushareToken} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className={hintClass}>{t("settings.data.tushareHint")}</span>
              <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={clearTushareToken}
                  onChange={(event) => onClearTushareTokenChange(event.target.checked)}
                  className="h-3.5 w-3.5 accent-primary"
                />
                {t("settings.clearTushareToken")}
              </label>
            </div>
          </label>
          <EnvPath value={dataSettings.env_path} />
          <PrimaryButton type="submit" disabled={saving} loading={saving} label={saving ? t("settings.saving") : t("settings.saveDataSourceSettings")} />
        </div>
        <div className="rounded-md border bg-muted/20 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-sm font-medium">{t("settings.baostock")}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs ${dataSettings.baostock_supported ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
              {dataSettings.baostock_supported ? t("settings.loaderAvailable") : t("settings.noProjectLoader")}
            </span>
          </div>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>{dataSettings.baostock_message}</p>
            <p>{dataSettings.baostock_installed ? t("settings.pythonPackageInstalled") : t("settings.pythonPackageNotInstalled")}</p>
          </div>
        </div>
      </div>
    </form>
  );
}

function PrimaryButton({
  type = "button",
  disabled,
  loading,
  label,
  className,
}: {
  type?: "button" | "submit";
  disabled?: boolean;
  loading?: boolean;
  label: string;
  className?: string;
}) {
  return (
    <button type={type} disabled={disabled} className={cn("inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70", className)}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
      {label}
    </button>
  );
}

function EnvPath({ value }: { value: string }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{t("settings.saved")}: </span>
      <span className="break-all font-mono">{value}</span>
    </div>
  );
}
