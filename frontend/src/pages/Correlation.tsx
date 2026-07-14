import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, BarChart3, CalendarRange, Calculator, Database, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Metric, Panel, SectionHeader } from "@/components/ui/Panel";
import { StatusIndicator } from "@/components/ui/Status";
import { CorrelationMatrix } from "@/components/charts/CorrelationMatrix";
import { cn } from "@/lib/utils";

const WINDOWS = [30, 60, 90, 180, 365] as const;

export function Correlation() {
  const { t } = useTranslation();
  const [codes, setCodes] = useState("000001.SZ,600519.SH,000858.SZ,601318.SH");
  const [days, setDays] = useState<number>(90);
  const [method, setMethod] = useState<"pearson" | "spearman">("pearson");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [labels, setLabels] = useState<string[]>([]);
  const [matrix, setMatrix] = useState<number[][]>([]);

  const normalizedCodes = useMemo(() => Array.from(new Set(codes.split(/[\s,;]+/).map((code) => code.trim()).filter(Boolean))), [codes]);
  const ready = normalizedCodes.length >= 2;

  const compute = async () => {
    if (!ready) {
      setError(t("correlation.minAssets"));
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const result = await request<{ labels: string[]; matrix: number[][] }>(`/correlation?codes=${encodeURIComponent(normalizedCodes.join(","))}&days=${days}&method=${method}`);
      setLabels(Array.isArray(result.labels) ? result.labels : []);
      setMatrix(Array.isArray(result.matrix) ? result.matrix : []);
    } catch (cause) {
      setLabels([]);
      setMatrix([]);
      setError(cause instanceof Error ? cause.message : t("correlation.failedToCompute"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div data-page-enter className="min-h-full bg-canvas px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="border-b border-[hsl(var(--border-subtle))] pb-5">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-primary"><BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />{t("correlation.badge")}</div>
          <h1 className="text-2xl font-semibold leading-8 text-ink-strong">{t("correlation.title")}</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-ink-muted">{t("correlation.subtitle")}</p>
        </header>

        <Panel padding="none" className="overflow-visible shadow-xs">
          <div className="px-4 py-4 sm:px-5"><SectionHeader title={t("correlation.configurationTitle")} description={t("correlation.configurationDescription")} eyebrow={<span className="inline-flex items-center gap-1.5"><SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />{t("correlation.controls")}</span>} /></div>
          <div className="grid gap-5 border-t border-[hsl(var(--border-subtle))] bg-surface-2/45 px-4 py-4 sm:px-5">
            <label className="grid gap-1.5">
              <span className="text-sm font-medium text-ink-strong">{t("correlation.assetCodes")}</span>
              <input value={codes} onChange={(event) => setCodes(event.target.value)} placeholder={t("correlation.placeholder")} className="h-10 w-full rounded-md border border-border bg-surface-1 px-3 text-sm text-ink-strong shadow-xs outline-none transition-[color,background-color,border-color,box-shadow] duration-fast placeholder:text-ink-disabled hover:border-ink-disabled focus:border-primary/60 focus:ring-2 focus:ring-primary/20" />
              <span className="text-xs leading-5 text-ink-muted">{t("correlation.assetCodesHint")}</span>
            </label>

            <div className="grid gap-5 lg:grid-cols-2">
              <SegmentedControl label={t("correlation.windowDays")} options={WINDOWS.map((window) => ({ value: String(window), label: t("correlation.days", { count: window }) }))} value={String(days)} onChange={(value) => setDays(Number(value))} />
              <SegmentedControl label={t("correlation.method")} options={(["pearson", "spearman"] as const).map((value) => ({ value, label: t(`correlation.method_${value}`) }))} value={method} onChange={(value) => setMethod(value as "pearson" | "spearman")} />
            </div>
          </div>
          <div className="flex flex-col gap-3 border-t border-[hsl(var(--border-subtle))] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="flex items-center gap-2 text-xs text-ink-muted"><Database className="h-3.5 w-3.5" aria-hidden="true" />{t("correlation.assetCount", { count: normalizedCodes.length })}</div>
            <Button variant="primary" onClick={() => void compute()} disabled={!ready} loading={loading} loadingLabel={t("correlation.loading")} leftIcon={<Calculator className="h-4 w-4" />}>{t("correlation.compute")}</Button>
          </div>
        </Panel>

        {error ? <div className="flex items-start gap-3 rounded-lg border border-warning/25 bg-warning/8 p-4 shadow-xs"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" /><div className="min-w-0"><div className="text-sm font-medium text-warning">{t("correlation.errorTitle")}</div><p className="mt-1 break-words text-sm text-ink">{error}</p></div></div> : null}

        {labels.length > 0 ? (
          <>
            <Panel padding="none" className="grid grid-cols-3 overflow-hidden shadow-xs">
              <Metric label={t("correlation.assets")} value={String(labels.length)} className="border-r border-[hsl(var(--border-subtle))] px-4 py-4 sm:px-5" />
              <Metric label={t("correlation.windowDays")} value={t("correlation.days", { count: days })} className="border-r border-[hsl(var(--border-subtle))] px-4 py-4 sm:px-5" />
              <Metric label={t("correlation.method")} value={t(`correlation.method_${method}`)} className="px-4 py-4 sm:px-5" />
            </Panel>
            <Panel padding="none" className="overflow-hidden shadow-xs">
              <div className="px-4 py-4 sm:px-5"><SectionHeader title={t("correlation.resultTitle")} description={t("correlation.resultDescription")} actions={<StatusIndicator label={t("correlation.complete")} tone="success" dot />} /></div>
              <div className="border-t border-[hsl(var(--border-subtle))] p-2 sm:p-4"><CorrelationMatrix labels={labels} matrix={matrix} height={520} /></div>
            </Panel>
          </>
        ) : !loading ? (
          <Panel className="py-12 text-center shadow-xs"><CalendarRange className="mx-auto h-7 w-7 text-ink-muted" aria-hidden="true" /><h2 className="mt-3 text-sm font-semibold text-ink-strong">{t("correlation.emptyTitle")}</h2><p className="mx-auto mt-1 max-w-lg text-sm leading-6 text-ink-muted">{t("correlation.emptyBody")}</p></Panel>
        ) : null}
      </div>
    </div>
  );
}

function SegmentedControl({ label, options, value, onChange }: { label: string; options: Array<{ value: string; label: string }>; value: string; onChange: (value: string) => void }) {
  return (
    <div className="grid gap-1.5"><span className="text-sm font-medium text-ink-strong">{label}</span><div className="flex flex-wrap gap-1 rounded-lg border border-[hsl(var(--border-subtle))] bg-surface-2 p-1">{options.map((option) => <button key={option.value} type="button" onClick={() => onChange(option.value)} className={cn("min-h-8 rounded-md px-3 text-xs font-medium transition-[color,background-color,box-shadow] duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30", value === option.value ? "bg-surface-1 text-primary shadow-xs" : "text-ink-muted hover:bg-surface-1/70 hover:text-ink-strong")}>{option.label}</button>)}</div></div>
  );
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { headers: { "Content-Type": "application/json", ...options?.headers }, ...options });
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      detail = body.detail || body.message || detail;
    } catch {
      // Keep the status fallback when an error body cannot be parsed.
    }
    throw new Error(detail);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : ({} as T);
}
