import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CalendarRange,
  FileText,
  GitCompare,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Metric, Panel, SectionHeader } from "@/components/ui/Panel";
import { Select, type SelectOption } from "@/components/ui/Select";
import { StatusIndicator, type StatusTone } from "@/components/ui/Status";
import { api, type RunListItem } from "@/lib/api";
import { formatMetricVal } from "@/lib/formatters";
import { cn } from "@/lib/utils";

const REPORT_SCAN_LIMIT = 100;

type SortMode = "created_desc" | "created_asc" | "return_desc" | "sharpe_desc";

export function Reports() {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("created_desc");
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(false);
  const requestSeqRef = useRef(0);
  const tRef = useRef(t);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const loadReports = useCallback(async (mode: "initial" | "refresh" = "refresh") => {
    const requestId = requestSeqRef.current + 1;
    requestSeqRef.current = requestId;
    if (mode === "initial") setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const list = await api.listRuns(REPORT_SCAN_LIMIT);
      if (!mountedRef.current || requestSeqRef.current !== requestId) return;
      setRuns(Array.isArray(list) ? list.filter(isBacktestReportRun) : []);
    } catch (err) {
      if (!mountedRef.current || requestSeqRef.current !== requestId) return;
      setRuns([]);
      setError(err instanceof Error ? err.message : tRef.current("reports.loadError"));
    } finally {
      if (!mountedRef.current || requestSeqRef.current !== requestId) return;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadReports("initial");
    return () => {
      mountedRef.current = false;
      requestSeqRef.current += 1;
    };
  }, [loadReports]);

  const statusOptions = useMemo<SelectOption[]>(() => {
    const values = Array.from(new Set(runs.map((run) => run.status || "unknown"))).sort();
    return [
      { value: "all", label: t("reports.allStatuses") },
      ...values.map((status) => ({ value: status, label: reportStatusLabel(status, t) })),
    ];
  }, [runs, t]);

  const sortOptions = useMemo<SelectOption[]>(() => [
    { value: "created_desc", label: t("reports.sortNewest") },
    { value: "created_asc", label: t("reports.sortOldest") },
    { value: "return_desc", label: t("reports.sortReturn") },
    { value: "sharpe_desc", label: t("reports.sortSharpe") },
  ], [t]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const startMs = startDate ? Date.parse(startDate) : Number.NEGATIVE_INFINITY;
    const endMs = endDate ? Date.parse(`${endDate}T23:59:59`) : Number.POSITIVE_INFINITY;

    return [...runs]
      .filter((run) => {
        if (statusFilter !== "all" && (run.status || "unknown") !== statusFilter) return false;
        const created = Date.parse(run.created_at);
        if (Number.isFinite(created) && (created < startMs || created > endMs)) return false;
        if (!needle) return true;
        const haystack = [
          run.run_id,
          run.status,
          run.prompt,
          ...(run.codes || []),
          run.start_date,
          run.end_date,
        ].filter(Boolean).join(" ").toLowerCase();
        return haystack.includes(needle);
      })
      .sort((left, right) => compareRuns(left, right, sortMode));
  }, [runs, query, statusFilter, startDate, endDate, sortMode]);

  const analytics = useMemo(() => buildReportAnalytics(filtered), [filtered]);
  const hasActiveFilters = Boolean(query.trim() || statusFilter !== "all" || startDate || endDate || sortMode !== "created_desc");

  const clearFilters = () => {
    setQuery("");
    setStatusFilter("all");
    setStartDate("");
    setEndDate("");
    setSortMode("created_desc");
  };

  return (
    <div data-page-enter className="min-h-full bg-canvas px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-4 border-b border-[hsl(var(--border-subtle))] pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-primary">
              <FileText className="h-3.5 w-3.5" aria-hidden="true" />
              {t("reports.badge")}
            </div>
            <h1 className="text-2xl font-semibold leading-8 text-ink-strong">{t("reports.title")}</h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-ink-muted">{t("reports.subtitle")}</p>
          </div>
          <Button
            variant="secondary"
            onClick={() => void loadReports("refresh")}
            loading={refreshing}
            loadingLabel={t("reports.refreshing")}
            leftIcon={<RefreshCw className="h-4 w-4" />}
          >
            {t("reports.refresh")}
          </Button>
        </header>

        {!loading && !error && runs.length > 0 ? <ReportAnalyticsPanel analytics={analytics} /> : null}

        <Panel padding="none" className="overflow-visible shadow-xs" aria-labelledby="report-workspace-title">
          <div className="px-4 py-4 sm:px-5">
            <SectionHeader
              title={<span id="report-workspace-title">{t("reports.workspaceTitle")}</span>}
              description={t("reports.workspaceDescription")}
              eyebrow={(
                <span className="inline-flex items-center gap-1.5">
                  <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("reports.filters")}
                </span>
              )}
              actions={hasActiveFilters ? (
                <Button variant="ghost" size="sm" onClick={clearFilters} leftIcon={<X className="h-3.5 w-3.5" />}>
                  {t("reports.clearFilters")}
                </Button>
              ) : undefined}
            />
          </div>

          <div className="grid gap-3 border-t border-[hsl(var(--border-subtle))] bg-surface-2/45 px-4 py-4 sm:grid-cols-2 sm:px-5 lg:grid-cols-[minmax(240px,1fr)_180px_155px_155px_190px]">
            <label className="relative block sm:col-span-2 lg:col-span-1">
              <span className="sr-only">{t("reports.searchLabel")}</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("reports.searchPlaceholder")}
                className="h-9 w-full rounded-md border border-border bg-surface-1 py-2 pl-9 pr-3 text-sm text-ink-strong shadow-xs outline-none transition-[color,background-color,border-color,box-shadow] duration-fast placeholder:text-ink-disabled hover:border-ink-disabled focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <Select
              value={statusFilter}
              onValueChange={setStatusFilter}
              options={statusOptions}
              label={t("reports.statusFilter")}
              className="w-full"
            />
            <DateField label={t("reports.startDate")} value={startDate} onChange={setStartDate} />
            <DateField label={t("reports.endDate")} value={endDate} onChange={setEndDate} />
            <Select
              value={sortMode}
              onValueChange={(value) => setSortMode(value as SortMode)}
              options={sortOptions}
              label={t("reports.sort")}
              align="end"
              className="w-full"
            />
          </div>

          <div className="flex min-h-10 items-center justify-between gap-3 border-t border-[hsl(var(--border-subtle))] px-4 py-2 sm:px-5">
            <p className="text-xs text-ink-muted" aria-live="polite">{t("reports.count", { shown: filtered.length, total: runs.length })}</p>
            {hasActiveFilters ? <StatusIndicator label={t("reports.filtersActive")} tone="primary" dot /> : null}
          </div>

          <ReportResults
            runs={filtered}
            totalRuns={runs.length}
            loading={loading}
            error={error}
          />
        </Panel>
      </div>
    </div>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="relative block">
      <span className="sr-only">{label}</span>
      <CalendarRange className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        className="h-9 w-full rounded-md border border-border bg-surface-1 py-2 pl-9 pr-2 text-sm text-ink-strong shadow-xs outline-none transition-[color,background-color,border-color,box-shadow] duration-fast hover:border-ink-disabled focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
      />
    </label>
  );
}

function ReportAnalyticsPanel({ analytics }: { analytics: ReportAnalytics }) {
  const { t } = useTranslation();
  const maxStatusCount = Math.max(1, ...analytics.statusRows.map((row) => row.count));
  const maxBucketCount = Math.max(1, ...analytics.returnBuckets.map((bucket) => bucket.count));

  return (
    <Panel padding="none" className="overflow-hidden shadow-xs" aria-labelledby="report-analytics-title">
      <div className="px-4 py-4 sm:px-5">
        <SectionHeader
          title={<span id="report-analytics-title">{t("reports.analyticsTitle")}</span>}
          description={t("reports.analyticsDescription")}
          eyebrow={(
            <span className="inline-flex items-center gap-1.5">
              <BarChart3 className="h-3.5 w-3.5" aria-hidden="true" />
              {t("reports.performanceSnapshot")}
            </span>
          )}
        />
      </div>
      <div className="grid grid-cols-2 border-t border-[hsl(var(--border-subtle))] sm:grid-cols-4">
        <MetricCell label={t("reports.totalReports")} value={String(analytics.totalReports)} />
        <MetricCell label={t("reports.bestReturn")} value={analytics.bestReturn == null ? "-" : formatMetricVal("total_return", analytics.bestReturn)} tone={metricTone(analytics.bestReturn)} />
        <MetricCell label={t("reports.bestSharpe")} value={analytics.bestSharpe == null ? "-" : analytics.bestSharpe.toFixed(2)} tone={metricTone(analytics.bestSharpe)} />
        <MetricCell label={t("reports.avgReturn")} value={analytics.averageReturn == null ? "-" : formatMetricVal("total_return", analytics.averageReturn)} tone={metricTone(analytics.averageReturn)} />
      </div>
      <div className="grid border-t border-[hsl(var(--border-subtle))] lg:grid-cols-2 lg:divide-x lg:divide-[hsl(var(--border-subtle))]">
        <DistributionPanel title={t("reports.statusDistribution")} rows={analytics.statusRows} maxCount={maxStatusCount} tone="primary" />
        <DistributionPanel
          title={t("reports.returnBuckets")}
          rows={analytics.returnBuckets.map((bucket) => ({ ...bucket, label: t(`reports.returnBucket.${bucket.label}`) }))}
          maxCount={maxBucketCount}
          tone="accent"
          className="border-t border-[hsl(var(--border-subtle))] lg:border-t-0"
        />
      </div>
    </Panel>
  );
}

function MetricCell({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "positive" | "negative" }) {
  return (
    <Metric
      label={label}
      value={value}
      className={cn(
        "border-r border-[hsl(var(--border-subtle))] px-4 py-4 last:border-r-0 sm:px-5",
        tone === "positive" && "[&>div:nth-child(2)]:text-success",
        tone === "negative" && "[&>div:nth-child(2)]:text-danger",
      )}
    />
  );
}

function DistributionPanel({
  title,
  rows,
  maxCount,
  tone,
  className,
}: {
  title: string;
  rows: Array<{ label: string; count: number }>;
  maxCount: number;
  tone: "primary" | "accent";
  className?: string;
}) {
  return (
    <div className={cn("px-4 py-4 sm:px-5", className)}>
      <h3 className="mb-3 text-xs font-semibold uppercase text-ink-muted">{title}</h3>
      <div className="grid gap-2.5">
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[minmax(72px,100px)_minmax(0,1fr)_32px] items-center gap-3 text-xs">
            <span className="truncate text-ink-muted" title={row.label}>{row.label}</span>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div
                className={cn("h-full rounded-full transition-[width] duration-slow ease-standard", tone === "primary" ? "bg-primary" : "bg-accent")}
                style={{ width: row.count ? `${Math.max(4, (row.count / maxCount) * 100)}%` : "0%" }}
              />
            </div>
            <span className="text-right tabular-nums text-ink-muted">{row.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReportResults({ runs, totalRuns, loading, error }: { runs: RunListItem[]; totalRuns: number; loading: boolean; error: string | null }) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <div className="border-t border-[hsl(var(--border-subtle))]" aria-label={t("reports.loading")}>
        {[1, 2, 3, 4].map((item) => (
          <div key={item} className="grid min-h-20 animate-pulse grid-cols-[minmax(0,1fr)_100px] items-center gap-4 border-b border-[hsl(var(--border-subtle))] px-4 last:border-b-0 sm:px-5">
            <div className="space-y-2"><div className="h-3 w-2/5 rounded bg-surface-3" /><div className="h-3 w-4/5 rounded bg-surface-2" /></div>
            <div className="h-7 rounded bg-surface-2" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="border-t border-[hsl(var(--border-subtle))] p-4 sm:p-5">
        <div className="flex items-start gap-3 rounded-md border border-warning/25 bg-warning/8 p-3.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-warning">{t("reports.unavailable")}</div>
            <p className="mt-1 break-words text-sm text-ink">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!runs.length) {
    const emptyLibrary = totalRuns === 0;
    return (
      <div className="border-t border-[hsl(var(--border-subtle))] px-5 py-12 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md border border-border bg-surface-2 text-ink-muted">
          <FileText className="h-5 w-5" aria-hidden="true" />
        </div>
        <h2 className="mt-3 text-sm font-semibold text-ink-strong">{emptyLibrary ? t("reports.emptyTitle") : t("reports.noMatchesTitle")}</h2>
        <p className="mx-auto mt-1 max-w-md text-sm leading-6 text-ink-muted">{emptyLibrary ? t("reports.emptyBody") : t("reports.noMatchesBody")}</p>
      </div>
    );
  }

  return (
    <div className="border-t border-[hsl(var(--border-subtle))]">
      <div className="hidden min-h-10 grid-cols-[minmax(230px,1.7fr)_minmax(110px,.8fr)_130px_100px_90px_130px_76px] items-center gap-3 bg-surface-2/55 px-5 text-xs font-medium text-ink-muted lg:grid">
        <span>{t("reports.columnReport")}</span>
        <span>{t("reports.columnUniverse")}</span>
        <span>{t("reports.columnPeriod")}</span>
        <span className="text-right">{t("reports.return")}</span>
        <span className="text-right">{t("reports.sharpe")}</span>
        <span>{t("reports.columnCreated")}</span>
        <span className="text-right">{t("reports.columnActions")}</span>
      </div>
      <div className="divide-y divide-[hsl(var(--border-subtle))]">
        {runs.map((run) => <ReportRow key={run.run_id} run={run} />)}
      </div>
    </div>
  );
}

function ReportRow({ run }: { run: RunListItem }) {
  const { t } = useTranslation();
  const returnTone = metricTone(run.total_return);
  return (
    <article className="group grid gap-3 px-4 py-4 transition-[background-color,box-shadow] duration-fast ease-standard hover:bg-surface-2/55 focus-within:bg-surface-2/55 sm:px-5 lg:min-h-24 lg:grid-cols-[minmax(230px,1.7fr)_minmax(110px,.8fr)_130px_100px_90px_130px_76px] lg:items-center lg:gap-3 lg:py-3">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <StatusIndicator label={reportStatusLabel(run.status, t)} tone={reportStatusTone(run.status)} dot />
          <Link to={`/runs/${run.run_id}`} className="min-w-0 truncate font-mono text-sm font-semibold text-ink-strong outline-none transition-colors duration-fast hover:text-primary focus-visible:text-primary" title={run.run_id}>
            {run.run_id}
          </Link>
        </div>
        <p className="mt-1.5 line-clamp-2 text-sm leading-5 text-ink-muted">{run.prompt || t("reports.noPrompt")}</p>
      </div>

      <div className="flex min-w-0 flex-wrap gap-1.5 lg:block">
        {(run.codes || []).length ? (
          <>
            {(run.codes || []).slice(0, 3).map((code) => <span key={code} className="mr-1 inline-flex rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-ink">{code}</span>)}
            {(run.codes || []).length > 3 ? <span className="text-xs text-ink-muted">+{(run.codes || []).length - 3}</span> : null}
          </>
        ) : <span className="text-sm text-ink-disabled">{t("reports.noUniverse")}</span>}
      </div>

      <div className="flex items-center gap-2 text-xs text-ink-muted lg:block">
        <span className="lg:hidden">{t("reports.columnPeriod")}</span>
        <span className="tabular-nums">{formatRunPeriod(run, t)}</span>
      </div>

      <MetricValue label={t("reports.return")} value={formatOptionalMetric("total_return", run.total_return)} tone={returnTone} />
      <MetricValue label={t("reports.sharpe")} value={formatOptionalMetric("sharpe", run.sharpe)} tone={metricTone(run.sharpe)} />

      <div className="flex items-center gap-2 text-xs text-ink-muted lg:block">
        <span className="lg:hidden">{t("reports.columnCreated")}</span>
        <time dateTime={run.created_at} className="tabular-nums">{formatRunDate(run.created_at)}</time>
      </div>

      <div className="flex items-center gap-1 lg:justify-end">
        <Link
          to={`/runs/${run.run_id}`}
          aria-label={t("reports.fullReport")}
          title={t("reports.fullReport")}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-ink-muted outline-none transition-[color,background-color,border-color,transform] duration-fast hover:border-primary/20 hover:bg-primary/8 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/30 active:translate-y-px"
        >
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
        <Link
          to="/compare"
          aria-label={t("reports.compare")}
          title={t("reports.compare")}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-ink-muted outline-none transition-[color,background-color,border-color,transform] duration-fast hover:border-primary/20 hover:bg-primary/8 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/30 active:translate-y-px"
        >
          <GitCompare className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}

function MetricValue({ label, value, tone }: { label: string; value: string; tone: "neutral" | "positive" | "negative" }) {
  return (
    <div className="flex items-center justify-between gap-3 lg:block lg:text-right">
      <span className="text-xs text-ink-muted lg:hidden">{label}</span>
      <span className={cn("font-mono text-sm font-semibold tabular-nums", tone === "positive" && "text-success", tone === "negative" && "text-danger", tone === "neutral" && "text-ink-strong")}>{value}</span>
    </div>
  );
}

interface ReportAnalytics {
  totalReports: number;
  bestReturn: number | null;
  bestSharpe: number | null;
  averageReturn: number | null;
  statusRows: Array<{ label: string; count: number }>;
  returnBuckets: Array<{ label: "positive" | "flat" | "negative"; count: number }>;
}

function buildReportAnalytics(runs: RunListItem[]): ReportAnalytics {
  const returns = runs.map((run) => run.total_return).filter(Number.isFinite) as number[];
  const sharpes = runs.map((run) => run.sharpe).filter(Number.isFinite) as number[];
  const statusCounts = new Map<string, number>();
  for (const run of runs) {
    const status = run.status || "unknown";
    statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
  }
  return {
    totalReports: runs.length,
    bestReturn: returns.length ? Math.max(...returns) : null,
    bestSharpe: sharpes.length ? Math.max(...sharpes) : null,
    averageReturn: returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : null,
    statusRows: Array.from(statusCounts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)),
    returnBuckets: [
      { label: "positive", count: returns.filter((value) => value > 0.001).length },
      { label: "flat", count: returns.filter((value) => value >= -0.001 && value <= 0.001).length },
      { label: "negative", count: returns.filter((value) => value < -0.001).length },
    ],
  };
}

function isBacktestReportRun(run: RunListItem): boolean {
  return Number.isFinite(run.total_return) || Number.isFinite(run.sharpe);
}

function compareRuns(left: RunListItem, right: RunListItem, mode: SortMode): number {
  if (mode === "created_asc") return dateMs(left.created_at) - dateMs(right.created_at);
  if (mode === "return_desc") return metric(right.total_return) - metric(left.total_return);
  if (mode === "sharpe_desc") return metric(right.sharpe) - metric(left.sharpe);
  return dateMs(right.created_at) - dateMs(left.created_at);
}

function reportStatusTone(status: string): StatusTone {
  const normalized = (status || "unknown").toLowerCase();
  if (["success", "done", "completed", "complete"].includes(normalized)) return "success";
  if (["failed", "error", "cancelled", "canceled"].includes(normalized)) return "danger";
  if (["running", "processing"].includes(normalized)) return "info";
  if (["pending", "queued", "waiting"].includes(normalized)) return "warning";
  return "neutral";
}

function reportStatusLabel(status: string, t: TFunction): string {
  const normalized = (status || "unknown").toLowerCase();
  const aliases: Record<string, string> = {
    success: "completed",
    done: "completed",
    complete: "completed",
    canceled: "cancelled",
    error: "failed",
    processing: "running",
    queued: "pending",
    waiting: "pending",
  };
  const key = aliases[normalized] || normalized;
  if (key === "completed") return t("reports.status.completed");
  if (key === "failed") return t("reports.status.failed");
  if (key === "cancelled") return t("reports.status.cancelled");
  if (key === "running") return t("reports.status.running");
  if (key === "pending") return t("reports.status.pending");
  if (key === "unknown") return t("reports.status.unknown");
  return status || t("reports.status.unknown");
}

function metricTone(value: number | undefined | null): "neutral" | "positive" | "negative" {
  if (!Number.isFinite(value)) return "neutral";
  if (Number(value) > 0) return "positive";
  if (Number(value) < 0) return "negative";
  return "neutral";
}

function metric(value: number | undefined): number {
  return Number.isFinite(value) ? Number(value) : Number.NEGATIVE_INFINITY;
}

function formatOptionalMetric(key: string, value: number | undefined): string {
  return Number.isFinite(value) ? formatMetricVal(key, value as number) : "-";
}

function formatRunPeriod(run: RunListItem, t: TFunction): string {
  if (!run.start_date && !run.end_date) return t("reports.noPeriod");
  return `${run.start_date || "?"} ${t("reports.to")} ${run.end_date || "?"}`;
}

function dateMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatRunDate(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value || "-";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}
