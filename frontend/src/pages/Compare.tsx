import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowRight, GitCompare, RefreshCw, Scale } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Metric, Panel, SectionHeader } from "@/components/ui/Panel";
import { Select, type SelectOption } from "@/components/ui/Select";
import { StatusIndicator, type StatusTone } from "@/components/ui/Status";
import { SkeletonChart, SkeletonMetrics } from "@/components/common/Skeleton";
import { useDarkMode } from "@/hooks/useDarkMode";
import { api, type EquityPoint, type RunData, type RunListItem } from "@/lib/api";
import { getChartTheme } from "@/lib/chart-theme";
import { CHART_GROUP, connectCharts, echarts } from "@/lib/echarts";
import { cn } from "@/lib/utils";

interface MetricDef {
  key: string;
  label: string;
  type: "pct" | "num" | "int" | "days";
  higherIsBetter: boolean;
}

function fmt(value: unknown, type: MetricDef["type"] = "num"): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  if (type === "pct") return `${(number * 100).toFixed(2)}%`;
  if (type === "int") return number.toFixed(0);
  if (type === "days") return number.toFixed(1);
  return number.toFixed(3);
}

function diffClass(left: unknown, right: unknown, higherIsBetter: boolean): string {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) return "text-ink-muted";
  const better = higherIsBetter ? rightNumber > leftNumber : rightNumber < leftNumber;
  const worse = higherIsBetter ? rightNumber < leftNumber : rightNumber > leftNumber;
  return better ? "text-success" : worse ? "text-danger" : "text-ink-strong";
}

function diffStr(left: unknown, right: unknown, type: MetricDef["type"]): string {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) return "-";
  const difference = rightNumber - leftNumber;
  return `${difference > 0 ? "+" : ""}${fmt(difference, type)}`;
}

function truncatePrompt(prompt: string | undefined, maxLength = 40): string {
  if (!prompt) return "";
  const trimmed = prompt.replace(/\n/g, " ").trim();
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}...` : trimmed;
}

function runLabel(run: RunListItem): string {
  return truncatePrompt(run.prompt) || run.run_id;
}

const METRIC_ALIASES: Record<string, string> = {
  annual_return: "annualized_return",
  calmar: "calmar_ratio",
  sortino: "sortino_ratio",
  profit_loss_ratio: "profit_factor",
  max_consec_loss: "max_consecutive_losses",
  max_consecutive_loss: "max_consecutive_losses",
  avg_hold_days: "avg_holding_period",
  avg_holding_days: "avg_holding_period",
};

function resolveMetric(metrics: Record<string, number> | null, key: string): number | undefined {
  if (!metrics) return undefined;
  if (metrics[key] !== undefined) return metrics[key];
  for (const [alias, canonical] of Object.entries(METRIC_ALIASES)) {
    if (canonical === key && metrics[alias] !== undefined) return metrics[alias];
  }
  return undefined;
}

function EquityChartOverlay({
  leftCurve,
  rightCurve,
  leftLabel,
  rightLabel,
}: {
  leftCurve: EquityPoint[];
  rightCurve: EquityPoint[];
  leftLabel: string;
  rightLabel: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { dark } = useDarkMode();

  useEffect(() => {
    if (!ref.current || (!leftCurve.length && !rightCurve.length)) return;
    const theme = getChartTheme();
    const chart = echarts.init(ref.current);
    chart.group = CHART_GROUP;
    connectCharts();

    const dates = Array.from(new Set([...leftCurve.map((point) => point.time), ...rightCurve.map((point) => point.time)])).sort();
    const leftMap = new Map(leftCurve.map((point) => [point.time, Number(point.equity)]));
    const rightMap = new Map(rightCurve.map((point) => [point.time, Number(point.equity)]));
    const styles = getComputedStyle(document.documentElement);
    const leftColor = styles.getPropertyValue("--chart-compare-a").trim() || "#25b1bf";
    const rightColor = styles.getPropertyValue("--chart-compare-b").trim() || "#de283b";

    chart.setOption({
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        backgroundColor: theme.tooltipBg,
        borderColor: theme.tooltipBorder,
        textStyle: { color: theme.tooltipText, fontSize: 11 },
      },
      legend: { data: [leftLabel, rightLabel], textStyle: { color: theme.textColor, fontSize: 11 }, right: 8, top: 4 },
      grid: { left: 8, right: 8, top: 36, bottom: 40, containLabel: true },
      xAxis: { type: "category", data: dates, axisLine: { lineStyle: { color: theme.axisColor } }, axisLabel: { color: theme.textColor, fontSize: 10 } },
      yAxis: { type: "value", splitLine: { lineStyle: { color: theme.gridColor } }, axisLabel: { color: theme.textColor, fontSize: 10 } },
      dataZoom: [{ type: "inside" }, { type: "slider", height: 20, bottom: 4 }],
      series: [
        { name: leftLabel, type: "line", data: dates.map((date) => leftMap.get(date) ?? null), symbol: "none", lineStyle: { color: leftColor, width: 2 }, connectNulls: true },
        { name: rightLabel, type: "line", data: dates.map((date) => rightMap.get(date) ?? null), symbol: "none", lineStyle: { color: rightColor, width: 2 }, connectNulls: true },
      ],
    });

    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [dark, leftCurve, leftLabel, rightCurve, rightLabel]);

  if (!leftCurve.length && !rightCurve.length) return null;
  return <div ref={ref} className="h-80 w-full" />;
}

export function Compare() {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [leftId, setLeftId] = useState("");
  const [rightId, setRightId] = useState("");
  const [leftData, setLeftData] = useState<Record<string, number> | null>(null);
  const [rightData, setRightData] = useState<Record<string, number> | null>(null);
  const [leftCurve, setLeftCurve] = useState<EquityPoint[]>([]);
  const [rightCurve, setRightCurve] = useState<EquityPoint[]>([]);
  const [leftLoading, setLeftLoading] = useState(false);
  const [rightLoading, setRightLoading] = useState(false);
  const [leftError, setLeftError] = useState<string | null>(null);
  const [rightError, setRightError] = useState<string | null>(null);
  const mountedRef = useRef(false);
  const runsRequestRef = useRef(0);
  const leftRequestRef = useRef(0);
  const rightRequestRef = useRef(0);

  const metrics = useMemo<MetricDef[]>(() => [
    { key: "total_return", label: t("compare.totalReturn"), type: "pct", higherIsBetter: true },
    { key: "annualized_return", label: t("compare.annualizedReturn"), type: "pct", higherIsBetter: true },
    { key: "sharpe", label: t("compare.sharpeRatio"), type: "num", higherIsBetter: true },
    { key: "calmar_ratio", label: t("compare.calmarRatio"), type: "num", higherIsBetter: true },
    { key: "sortino_ratio", label: t("compare.sortinoRatio"), type: "num", higherIsBetter: true },
    { key: "max_drawdown", label: t("compare.maxDrawdown"), type: "pct", higherIsBetter: false },
    { key: "volatility", label: t("compare.volatility"), type: "pct", higherIsBetter: false },
    { key: "win_rate", label: t("compare.winRate"), type: "pct", higherIsBetter: true },
    { key: "profit_factor", label: t("compare.profitFactor"), type: "num", higherIsBetter: true },
    { key: "avg_win", label: t("compare.avgWin"), type: "pct", higherIsBetter: true },
    { key: "avg_loss", label: t("compare.avgLoss"), type: "pct", higherIsBetter: false },
    { key: "trade_count", label: t("compare.trades"), type: "int", higherIsBetter: true },
    { key: "max_consecutive_losses", label: t("compare.maxConsecLosses"), type: "int", higherIsBetter: false },
    { key: "exposure_time", label: t("compare.exposureTime"), type: "pct", higherIsBetter: true },
    { key: "avg_holding_period", label: t("compare.avgHoldingPeriod"), type: "days", higherIsBetter: false },
  ], [t]);

  const loadRuns = useCallback(async (mode: "initial" | "refresh" = "refresh") => {
    const requestId = ++runsRequestRef.current;
    if (mode === "initial") setRunsLoading(true);
    else setRefreshing(true);
    try {
      const response = await api.listRuns();
      if (!mountedRef.current || requestId !== runsRequestRef.current) return;
      const nextRuns = Array.isArray(response) ? response : [];
      setRuns(nextRuns);
      setRunsError(null);
      setLeftId((current) => current && nextRuns.some((run) => run.run_id === current) ? current : nextRuns[1]?.run_id || nextRuns[0]?.run_id || "");
      setRightId((current) => current && nextRuns.some((run) => run.run_id === current) ? current : nextRuns[0]?.run_id || "");
    } catch (error) {
      if (!mountedRef.current || requestId !== runsRequestRef.current) return;
      setRuns([]);
      setRunsError(error instanceof Error ? error.message : t("compare.loadError"));
    } finally {
      if (mountedRef.current && requestId === runsRequestRef.current) {
        setRunsLoading(false);
        setRefreshing(false);
      }
    }
  }, [t]);

  useEffect(() => {
    mountedRef.current = true;
    void loadRuns("initial");
    return () => {
      mountedRef.current = false;
      runsRequestRef.current += 1;
      leftRequestRef.current += 1;
      rightRequestRef.current += 1;
    };
  }, [loadRuns]);

  useEffect(() => {
    const requestId = ++leftRequestRef.current;
    if (!leftId) {
      setLeftData(null);
      setLeftCurve([]);
      setLeftError(null);
      setLeftLoading(false);
      return;
    }
    setLeftLoading(true);
    setLeftError(null);
    api.getRun(leftId).then((data: RunData) => {
      if (!mountedRef.current || requestId !== leftRequestRef.current) return;
      setLeftData(data.metrics || null);
      setLeftCurve(data.equity_curve || []);
    }).catch((error) => {
      if (!mountedRef.current || requestId !== leftRequestRef.current) return;
      setLeftData(null);
      setLeftCurve([]);
      setLeftError(error instanceof Error ? error.message : t("compare.runLoadError"));
    }).finally(() => {
      if (mountedRef.current && requestId === leftRequestRef.current) setLeftLoading(false);
    });
  }, [leftId, t]);

  useEffect(() => {
    const requestId = ++rightRequestRef.current;
    if (!rightId) {
      setRightData(null);
      setRightCurve([]);
      setRightError(null);
      setRightLoading(false);
      return;
    }
    setRightLoading(true);
    setRightError(null);
    api.getRun(rightId).then((data: RunData) => {
      if (!mountedRef.current || requestId !== rightRequestRef.current) return;
      setRightData(data.metrics || null);
      setRightCurve(data.equity_curve || []);
    }).catch((error) => {
      if (!mountedRef.current || requestId !== rightRequestRef.current) return;
      setRightData(null);
      setRightCurve([]);
      setRightError(error instanceof Error ? error.message : t("compare.runLoadError"));
    }).finally(() => {
      if (mountedRef.current && requestId === rightRequestRef.current) setRightLoading(false);
    });
  }, [rightId, t]);

  const leftRun = runs.find((run) => run.run_id === leftId);
  const rightRun = runs.find((run) => run.run_id === rightId);
  const loading = leftLoading || rightLoading;
  const hasData = Boolean(leftData || rightData);
  const leftOptions = useMemo<SelectOption[]>(() => [
    { value: "", label: t("compare.select") },
    ...runs.map((run) => ({ value: run.run_id, label: runLabel(run), description: `${run.run_id} · ${run.status}`, disabled: run.run_id === rightId })),
  ], [rightId, runs, t]);
  const rightOptions = useMemo<SelectOption[]>(() => [
    { value: "", label: t("compare.select") },
    ...runs.map((run) => ({ value: run.run_id, label: runLabel(run), description: `${run.run_id} · ${run.status}`, disabled: run.run_id === leftId })),
  ], [leftId, runs, t]);
  const score = useMemo(() => comparisonScore(leftData, rightData, metrics), [leftData, metrics, rightData]);

  return (
    <div data-page-enter className="min-h-full bg-canvas px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-4 border-b border-[hsl(var(--border-subtle))] pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-primary"><GitCompare className="h-3.5 w-3.5" aria-hidden="true" />{t("compare.badge")}</div>
            <h1 className="text-2xl font-semibold leading-8 text-ink-strong">{t("compare.title")}</h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-ink-muted">{t("compare.subtitle")}</p>
          </div>
          <Button variant="secondary" onClick={() => void loadRuns("refresh")} loading={refreshing} loadingLabel={t("compare.refreshing")} leftIcon={<RefreshCw className="h-4 w-4" />}>{t("compare.refresh")}</Button>
        </header>

        <Panel padding="none" className="overflow-visible shadow-xs">
          <div className="px-4 py-4 sm:px-5"><SectionHeader title={t("compare.selectionTitle")} description={t("compare.selectionDescription")} /></div>
          <div className="grid items-end gap-3 border-t border-[hsl(var(--border-subtle))] bg-surface-2/45 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_36px_minmax(0,1fr)] sm:px-5">
            <RunSelect label={t("compare.baseline")} value={leftId} options={leftOptions} onChange={setLeftId} searchPlaceholder={t("compare.searchRuns")} />
            <div className="hidden h-9 items-center justify-center text-ink-muted sm:flex"><ArrowRight className="h-4 w-4" aria-hidden="true" /></div>
            <RunSelect label={t("compare.compare")} value={rightId} options={rightOptions} onChange={setRightId} searchPlaceholder={t("compare.searchRuns")} align="end" />
          </div>
          {(leftRun || rightRun) ? (
            <div className="grid border-t border-[hsl(var(--border-subtle))] md:grid-cols-2 md:divide-x md:divide-[hsl(var(--border-subtle))]">
              <RunSummary run={leftRun} label={t("compare.baseline")} tone="primary" />
              <RunSummary run={rightRun} label={t("compare.compare")} tone="info" className="border-t border-[hsl(var(--border-subtle))] md:border-t-0" />
            </div>
          ) : null}
        </Panel>

        {runsError ? <InlineError title={t("compare.unavailable")} message={runsError} /> : null}
        {leftError || rightError ? <InlineError title={t("compare.runUnavailable")} message={leftError || rightError || ""} /> : null}

        {loading && !hasData ? <div className="space-y-5"><Panel><SkeletonChart height={320} /></Panel><Panel padding="none"><SkeletonMetrics /></Panel></div> : null}

        {hasData ? (
          <Panel padding="none" className="grid grid-cols-3 overflow-hidden shadow-xs">
            <Metric label={t("compare.baselineAdvantages")} value={String(score.baseline)} className="border-r border-[hsl(var(--border-subtle))] px-4 py-4 sm:px-5" />
            <Metric label={t("compare.comparisonAdvantages")} value={String(score.comparison)} className="border-r border-[hsl(var(--border-subtle))] px-4 py-4 sm:px-5" />
            <Metric label={t("compare.comparableMetrics")} value={String(score.comparable)} className="px-4 py-4 sm:px-5" />
          </Panel>
        ) : null}

        {(leftCurve.length || rightCurve.length) ? (
          <Panel padding="none" className="overflow-hidden shadow-xs">
            <div className="px-4 py-4 sm:px-5"><SectionHeader title={t("compare.equityDrawdown")} description={t("compare.chartDescription")} /></div>
            <div className="border-t border-[hsl(var(--border-subtle))] p-2 sm:p-4"><EquityChartOverlay leftCurve={leftCurve} rightCurve={rightCurve} leftLabel={leftRun ? truncatePrompt(leftRun.prompt, 20) || t("compare.baseline") : t("compare.baseline")} rightLabel={rightRun ? truncatePrompt(rightRun.prompt, 20) || t("compare.compare") : t("compare.compare")} /></div>
          </Panel>
        ) : null}

        {(leftData || rightData) ? <MetricsComparison metrics={metrics} leftData={leftData} rightData={rightData} /> : null}

        {!hasData && !loading && !runsLoading && !runsError ? (
          <Panel className="py-12 text-center shadow-xs"><Scale className="mx-auto h-7 w-7 text-ink-muted" aria-hidden="true" /><h2 className="mt-3 text-sm font-semibold text-ink-strong">{t("compare.emptyTitle")}</h2><p className="mx-auto mt-1 max-w-lg text-sm leading-6 text-ink-muted">{t("compare.selectTwoRuns")}</p></Panel>
        ) : null}
      </div>
    </div>
  );
}

function RunSelect({ label, value, options, onChange, searchPlaceholder, align = "start" }: { label: string; value: string; options: SelectOption[]; onChange: (value: string) => void; searchPlaceholder: string; align?: "start" | "end" }) {
  return <div className="min-w-0"><div className="mb-1.5 text-xs font-medium text-ink-muted">{label}</div><Select value={value} onValueChange={onChange} options={options} label={label} searchable searchPlaceholder={searchPlaceholder} className="w-full" align={align} /></div>;
}

function RunSummary({ run, label, tone, className }: { run?: RunListItem; label: string; tone: StatusTone; className?: string }) {
  const { t } = useTranslation();
  return (
    <div className={cn("min-w-0 px-4 py-4 sm:px-5", className)}>
      <div className="flex items-center gap-2"><StatusIndicator label={label} tone={tone} dot /><span className="truncate font-mono text-xs text-ink-muted">{run?.run_id || t("compare.notSelected")}</span></div>
      <p className="mt-2 line-clamp-2 text-sm leading-5 text-ink-strong">{run?.prompt || t("compare.noPrompt")}</p>
    </div>
  );
}

function MetricsComparison({ metrics, leftData, rightData }: { metrics: MetricDef[]; leftData: Record<string, number> | null; rightData: Record<string, number> | null }) {
  const { t } = useTranslation();
  return (
    <Panel padding="none" className="overflow-hidden shadow-xs">
      <div className="px-4 py-4 sm:px-5"><SectionHeader title={t("compare.metricsTitle")} description={t("compare.metricsDescription")} actions={<StatusIndicator label={t("compare.metricRows", { count: metrics.length })} tone="neutral" />} /></div>
      <div className="overflow-x-auto border-t border-[hsl(var(--border-subtle))]">
        <table className="w-full min-w-[640px] text-sm">
          <thead><tr className="bg-surface-2/55 text-xs text-ink-muted"><th className="px-5 py-2.5 text-left font-medium">{t("compare.metric")}</th><th className="px-4 py-2.5 text-right font-medium">{t("compare.baselineCol")}</th><th className="px-4 py-2.5 text-right font-medium">{t("compare.compareCol")}</th><th className="px-5 py-2.5 text-right font-medium">{t("compare.delta")}</th></tr></thead>
          <tbody className="divide-y divide-[hsl(var(--border-subtle))]">
            {metrics.map(({ key, label, type, higherIsBetter }) => {
              const left = resolveMetric(leftData, key);
              const right = resolveMetric(rightData, key);
              return <tr key={key} className="transition-colors duration-fast hover:bg-surface-2/45"><td className="px-5 py-3 font-medium text-ink-strong">{label}</td><td className="px-4 py-3 text-right font-mono tabular-nums text-ink">{fmt(left, type)}</td><td className="px-4 py-3 text-right font-mono tabular-nums text-ink">{fmt(right, type)}</td><td className={cn("px-5 py-3 text-right font-mono font-semibold tabular-nums", diffClass(left, right, higherIsBetter))}>{diffStr(left, right, type)}</td></tr>;
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function InlineError({ title, message }: { title: string; message: string }) {
  return <div className="flex items-start gap-3 rounded-lg border border-warning/25 bg-warning/8 p-4 shadow-xs"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" /><div className="min-w-0"><div className="text-sm font-medium text-warning">{title}</div><p className="mt-1 break-words text-sm text-ink">{message}</p></div></div>;
}

function comparisonScore(leftData: Record<string, number> | null, rightData: Record<string, number> | null, metrics: MetricDef[]) {
  let baseline = 0;
  let comparison = 0;
  let comparable = 0;
  for (const metric of metrics) {
    const left = resolveMetric(leftData, metric.key);
    const right = resolveMetric(rightData, metric.key);
    if (!Number.isFinite(left) || !Number.isFinite(right) || left === right) continue;
    comparable += 1;
    const comparisonBetter = metric.higherIsBetter ? Number(right) > Number(left) : Number(right) < Number(left);
    if (comparisonBetter) comparison += 1;
    else baseline += 1;
  }
  return { baseline, comparison, comparable };
}
