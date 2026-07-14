import i18n from "@/i18n";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useParams, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Box,
  ChevronDown,
  ChevronUp,
  Clipboard,
  Code2,
  Database,
  Download,
  FileCheck2,
  Files,
  Fingerprint,
  List,
  ScrollText,
  ShieldCheck,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { api, type BacktestMetrics, type RunCard, type RunData } from "@/lib/api";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import { CandlestickChart } from "@/components/charts/CandlestickChart";
import { EquityChart } from "@/components/charts/EquityChart";
import { MetricsCard } from "@/components/chat/MetricsCard";
import { ValidationPanel } from "@/components/charts/ValidationPanel";
import { Skeleton, SkeletonMetrics, SkeletonChart } from "@/components/common/Skeleton";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { Button, IconButton } from "@/components/ui/Button";
import { Metric, Panel, SectionHeader } from "@/components/ui/Panel";
import { Progress } from "@/components/ui/Progress";
import { Select } from "@/components/ui/Select";
import { StatusIndicator, type StatusTone } from "@/components/ui/Status";
import { Tab, TabList, TabPanel, Tabs } from "@/components/ui/Tabs";

const rehypePlugins = [rehypeHighlight];

type Tab = "chart" | "trades" | "validation" | "runCard" | "artifacts" | "logs" | "code";
type ChartPayload = Pick<RunData, "price_series" | "indicator_series" | "trade_markers">;
type ChartCache = Record<string, ChartPayload>;
type ChartLoadProgress = { done: number; total: number };

function downloadCsv(filename: string, csvContent: string) {
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeCsvField(value: unknown): string {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildTradesCsv(trades: Array<Record<string, string>>): string {
  if (trades.length === 0) return "";
  const keys = [...new Set(trades.flatMap(Object.keys))];
  const header = keys.map(escapeCsvField).join(",");
  const rows = trades.map(tr => keys.map(k => escapeCsvField(tr[k])).join(","));
  return [header, ...rows].join("\n");
}

function buildMetricsCsv(metrics: BacktestMetrics): string {
  const header = "metric,value";
  const rows = Object.entries(metrics).map(([k, v]) => `${escapeCsvField(k)},${escapeCsvField(v)}`);
  return [header, ...rows].join("\n");
}

function cacheFromRun(run: RunData | null, requestedSymbol?: string): ChartCache {
  if (!run?.price_series) return {};
  const cache: ChartCache = {};
  const markerRows = run.trade_markers || [];
  for (const [symbol, bars] of Object.entries(run.price_series)) {
    cache[symbol] = {
      price_series: { [symbol]: bars },
      indicator_series: run.indicator_series?.[symbol] ? { [symbol]: run.indicator_series[symbol] } : {},
      trade_markers: markerRows.filter((marker) => !marker.code || marker.code === symbol),
    };
  }
  if (requestedSymbol && !cache[requestedSymbol]) {
    cache[requestedSymbol] = { price_series: {}, indicator_series: {}, trade_markers: [] };
  }
  return cache;
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

export function RunDetail() {
  const { t } = useTranslation();
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const [run, setRun] = useState<RunData | null>(null);
  const [code, setCode] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<Tab>("chart");
  const [loading, setLoading] = useState(true);
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [chartPickerSymbol, setChartPickerSymbol] = useState("");
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>([]);
  const [chartCache, setChartCache] = useState<ChartCache>({});
  const [chartLoadingSymbols, setChartLoadingSymbols] = useState<Record<string, boolean>>({});
  const [bulkChartLoading, setBulkChartLoading] = useState(false);
  const [bulkChartProgress, setBulkChartProgress] = useState<ChartLoadProgress>({ done: 0, total: 0 });
  const chartCacheRef = useRef<ChartCache>({});
  const cancelBulkChartLoadRef = useRef(false);

  const hasValidation = !!run?.validation;
  const hasRunCard = !!run?.run_card;
  const hasArtifacts = Boolean(run?.artifacts?.length || run?.run_card?.artifacts?.length);
  const hasLogs = Boolean(run?.run_logs?.length);
  const TABS: { id: Tab; label: string; icon: typeof BarChart3; hidden?: boolean }[] = [
    { id: "chart", label: t("runDetail.chart"), icon: BarChart3 },
    { id: "trades", label: t("runDetail.trades"), icon: List },
    { id: "validation", label: t("runDetail.validation"), icon: ShieldCheck, hidden: !hasValidation },
    { id: "runCard", label: t("runDetail.runCard"), icon: FileCheck2, hidden: !hasRunCard },
    { id: "artifacts", label: t("runDetail.artifacts"), icon: Files, hidden: !hasArtifacts },
    { id: "logs", label: t("runDetail.logs"), icon: ScrollText, hidden: !hasLogs },
    { id: "code", label: t("runDetail.code"), icon: Code2 },
  ];

  useEffect(() => {
    if (!runId) return;
    Promise.all([
      api.getRun(runId, { chart_payload: "summary" }).catch(() => null),
      api.getRunCode(runId).catch(() => ({})),
    ]).then(([r, c]) => {
      setRun(r);
      setCode(c || {});
      const firstSymbol = r?.chart_symbols?.[0] || Object.keys(r?.price_series || {})[0] || "";
      setSelectedSymbol(firstSymbol);
      setChartPickerSymbol(firstSymbol);
      setSelectedSymbols(firstSymbol ? [firstSymbol] : []);
      const initialCache = cacheFromRun(r, firstSymbol);
      chartCacheRef.current = initialCache;
      setChartCache(initialCache);
      if (firstSymbol && !initialCache[firstSymbol]?.price_series?.[firstSymbol]?.length) {
        void loadChartSymbol(firstSymbol);
      }
    }).finally(() => setLoading(false));
  }, [runId]);

  if (loading) {
    return (
      <div className="min-h-full bg-canvas px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-7xl space-y-5">
          <Skeleton className="h-8 w-64" />
          <SkeletonMetrics />
          <SkeletonChart height={400} />
        </div>
      </div>
    );
  }
  if (!run) return (
    <div data-page-enter className="min-h-full bg-canvas px-4 py-10 sm:px-6 lg:px-8">
      <Panel className="mx-auto max-w-xl text-center shadow-xs">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md border border-danger/20 bg-danger/8 text-danger">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        </div>
        <h1 className="mt-3 text-base font-semibold text-ink-strong">{t("runDetail.runNotFound")}</h1>
        <p className="mt-1 text-sm leading-6 text-ink-muted">{t("runDetail.runNotFoundDesc")}</p>
        <Button className="mt-4" variant="secondary" onClick={() => navigate(-1)} leftIcon={<ArrowLeft className="h-4 w-4" />}>
          {t("runDetail.goBack")}
        </Button>
      </Panel>
    </div>
  );

  async function loadChartSymbol(symbol: string) {
    if (!runId || !symbol) return;
    if (chartCacheRef.current[symbol]?.price_series?.[symbol]?.length) return;
    setChartLoadingSymbols((prev) => ({ ...prev, [symbol]: true }));
    try {
      const nextRun = await api.getRun(runId, { chart_symbol: symbol });
      const nextCache = cacheFromRun(nextRun, symbol);
      const mergedCache = { ...chartCacheRef.current, ...nextCache };
      chartCacheRef.current = mergedCache;
      setChartCache(mergedCache);
      setRun((prev) => prev ? {
        ...prev,
        chart_symbols: nextRun.chart_symbols?.length ? nextRun.chart_symbols : prev.chart_symbols,
        equity_curve: nextRun.equity_curve?.length ? nextRun.equity_curve : prev.equity_curve,
        trade_log: nextRun.trade_log?.length ? nextRun.trade_log : prev.trade_log,
      } : nextRun);
    } finally {
      setChartLoadingSymbols((prev) => {
        const next = { ...prev };
        delete next[symbol];
        return next;
      });
    }
  }

  async function handleAddChartSymbol(symbol: string) {
    if (!symbol) return;
    setSelectedSymbol(symbol);
    setChartPickerSymbol(symbol);
    setSelectedSymbols((prev) => prev.includes(symbol) ? prev : [...prev, symbol]);
    await loadChartSymbol(symbol);
  }

  async function handleCurrentChartOnly(symbol: string) {
    if (!symbol) return;
    setSelectedSymbol(symbol);
    setChartPickerSymbol(symbol);
    setSelectedSymbols([symbol]);
    await loadChartSymbol(symbol);
  }

  function handleRemoveChartSymbol(symbol: string) {
    const nextSymbols = selectedSymbols.filter((item) => item !== symbol);
    setSelectedSymbols(nextSymbols);
    if (selectedSymbol === symbol) {
      const fallback = nextSymbols[0] || run?.chart_symbols?.[0] || "";
      setSelectedSymbol(fallback);
      setChartPickerSymbol(fallback);
    }
  }

  async function handleLoadAllChartSymbols() {
    const symbols = run?.chart_symbols || [];
    if (symbols.length === 0 || bulkChartLoading) return;
    cancelBulkChartLoadRef.current = false;
    setBulkChartLoading(true);
    setBulkChartProgress({ done: 0, total: symbols.length });
    try {
      for (let index = 0; index < symbols.length; index += 1) {
        if (cancelBulkChartLoadRef.current) break;
        const symbol = symbols[index];
        setSelectedSymbol(symbol);
        setChartPickerSymbol(symbol);
        setSelectedSymbols((prev) => prev.includes(symbol) ? prev : [...prev, symbol]);
        await loadChartSymbol(symbol);
        setBulkChartProgress({ done: index + 1, total: symbols.length });
        await yieldToBrowser();
      }
    } finally {
      setBulkChartLoading(false);
    }
  }

  function handleCancelLoadAllCharts() {
    cancelBulkChartLoadRef.current = true;
  }

  return (
    <div data-page-enter className="min-h-full bg-canvas px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
      <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)} className="mx-auto flex w-full max-w-7xl flex-col gap-5">
        <header className="border-b border-[hsl(var(--border-subtle))] pb-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <IconButton label={t("runDetail.goBack")} onClick={() => navigate(-1)} variant="ghost" className="mt-0.5">
                <ArrowLeft className="h-4 w-4" />
              </IconButton>
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <StatusIndicator label={runStatusLabel(run.status, t)} tone={runStatusTone(run.status)} dot />
                  <h1 className="min-w-0 truncate font-mono text-base font-semibold text-ink-strong" title={runId}>{runId}</h1>
                </div>
                <p className="mt-1.5 max-w-4xl text-sm leading-6 text-ink-muted">{run.prompt || t("runDetail.noPrompt")}</p>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
              {run.trade_log?.length ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => downloadCsv(`trades_${runId}.csv`, buildTradesCsv(run.trade_log!))}
                  leftIcon={<Download className="h-3.5 w-3.5" />}
                >
                  {t("runDetail.tradesCsv")}
                </Button>
              ) : null}
              {run.metrics ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => downloadCsv(`metrics_${runId}.csv`, buildMetricsCsv(run.metrics!))}
                  leftIcon={<Download className="h-3.5 w-3.5" />}
                >
                  {t("runDetail.metricsCsv")}
                </Button>
              ) : null}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 overflow-hidden rounded-lg border border-[hsl(var(--border-subtle))] bg-surface-1 sm:grid-cols-4">
            <Metric label={t("runDetail.elapsed")} value={formatElapsed(run.elapsed_seconds)} className="border-r border-[hsl(var(--border-subtle))] px-4 py-3" />
            <Metric label={t("runDetail.symbols")} value={String(run.chart_symbols?.length || Object.keys(run.price_series || {}).length)} className="border-r border-[hsl(var(--border-subtle))] px-4 py-3" />
            <Metric label={t("runDetail.tradeCount")} value={String(run.trade_log?.length || 0)} className="border-r border-[hsl(var(--border-subtle))] px-4 py-3" />
            <Metric label={t("runDetail.artifactCount")} value={String(run.artifacts?.length || run.run_card?.artifacts?.length || 0)} className="px-4 py-3" />
          </div>

          {run.metrics ? <div className="mt-3"><MetricsCard metrics={run.metrics as Record<string, number>} compact /></div> : null}

          <div className="mt-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <TabList className="w-full xl:w-auto">
              {TABS.filter((item) => !item.hidden).map(({ id, label, icon: Icon }) => (
                <Tab key={id} value={id}>
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  {label}
                </Tab>
              ))}
            </TabList>
            <div className="text-xs text-ink-muted">{t("runDetail.updatedStatus", { status: runStatusLabel(run.status, t) })}</div>
          </div>
        </header>

        <ErrorBoundary>
          <TabPanel value="chart">
            <ChartTab
              run={run}
              chartPickerSymbol={chartPickerSymbol}
              selectedSymbols={selectedSymbols}
              chartCache={chartCache}
              loadingSymbols={chartLoadingSymbols}
              bulkLoading={bulkChartLoading}
              bulkProgress={bulkChartProgress}
              onPickSymbol={setChartPickerSymbol}
              onAddSymbol={handleAddChartSymbol}
              onCurrentOnly={handleCurrentChartOnly}
              onRemoveSymbol={handleRemoveChartSymbol}
              onLoadAll={handleLoadAllChartSymbols}
              onCancelLoadAll={handleCancelLoadAllCharts}
            />
          </TabPanel>
          <TabPanel value="trades"><TradesTab run={run} /></TabPanel>
          {run.validation ? <TabPanel value="validation"><ValidationPanel data={run.validation} /></TabPanel> : null}
          {run.run_card ? <TabPanel value="runCard"><RunCardTab card={run.run_card} /></TabPanel> : null}
          {hasArtifacts ? <TabPanel value="artifacts"><ArtifactsTab run={run} /></TabPanel> : null}
          {hasLogs ? <TabPanel value="logs"><LogsTab logs={run.run_logs || []} /></TabPanel> : null}
          <TabPanel value="code"><CodeTab code={code} /></TabPanel>
        </ErrorBoundary>
      </Tabs>
    </div>
  );
}

function RunCardTab({ card }: { card: RunCard }) {
  const backtest = card.backtest || {};
  const reproducibility = card.reproducibility || {};
  const metrics = card.metrics || {};
  const artifacts = card.artifacts || [];
  const warnings = card.warnings || [];
  const dataSources = card.data_sources || [];

  return (
    <div className="space-y-5">
      <Panel padding="none" className="grid grid-cols-2 overflow-hidden shadow-xs md:grid-cols-4">
        <RunCardStat label={i18n.t("runDetail.schema")} value={card.schema_version || i18n.t("runDetail.unknown")} />
        <RunCardStat label={i18n.t("runDetail.generated")} value={formatRunCardValue(card.generated_at)} />
        <RunCardStat label={i18n.t("runDetail.dataSources")} value={dataSources.length ? dataSources.join(", ") : i18n.t("runDetail.noneRecorded")} />
        <RunCardStat label={i18n.t("runDetail.warnings")} value={String(warnings.length)} tone={warnings.length ? "warning" : "normal"} />
      </Panel>

      {warnings.length > 0 && (
        <section className="rounded-lg border border-warning/25 bg-warning/8 p-4 shadow-xs">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-warning">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            {i18n.t("runDetail.warnings")}
          </div>
          <ul className="grid gap-1.5 text-sm leading-5 text-ink-muted">
            {warnings.map((warning, index) => <li key={index} className="border-l-2 border-warning/35 pl-3">{warning}</li>)}
          </ul>
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <RunCardPanel title={i18n.t("runDetail.backtestSummary")} icon={Database}>
          <KeyValueTable data={backtest} empty={i18n.t("runDetail.noBacktestSummary")} />
        </RunCardPanel>
        <RunCardPanel title={i18n.t("runDetail.reproducibility")} icon={Fingerprint}>
          <KeyValueTable data={reproducibility} empty={i18n.t("runDetail.noReproducibilityHashes")} monospaceValues />
        </RunCardPanel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <RunCardPanel title={i18n.t("runDetail.metrics")} icon={BarChart3}>
          <KeyValueTable data={metrics} empty={i18n.t("runDetail.noScalarMetrics")} />
        </RunCardPanel>
        <RunCardPanel title={i18n.t("runDetail.validationPayload")} icon={ShieldCheck}>
          {card.validation ? (
            <pre className="max-h-80 overflow-auto rounded-md border border-border bg-surface-2 p-3 font-mono text-xs leading-relaxed text-ink">
              {JSON.stringify(card.validation, null, 2)}
            </pre>
          ) : (
            <p className="text-sm text-ink-muted">{i18n.t("runDetail.noValidationPayload")}</p>
          )}
        </RunCardPanel>
      </div>

      <RunCardPanel title={i18n.t("runDetail.artifactChecksums")} icon={FileCheck2}>
        {artifacts.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[hsl(var(--border-subtle))] bg-surface-2/55 text-left text-xs text-ink-muted">
                  <th className="py-2 pr-4">{i18n.t("runDetail.path")}</th>
                  <th className="py-2 pr-4">{i18n.t("runDetail.size")}</th>
                  <th className="py-2">{i18n.t("runDetail.sha256")}</th>
                </tr>
              </thead>
              <tbody>
                {artifacts.map((artifact) => (
                  <tr key={`${artifact.path}-${artifact.sha256}`} className="border-b border-[hsl(var(--border-subtle))] transition-colors duration-fast last:border-0 hover:bg-surface-2/45">
                    <td className="py-2 pr-4 font-mono text-xs">{artifact.path}</td>
                    <td className="py-2 pr-4 tabular-nums text-ink-muted">{formatBytes(artifact.size_bytes)}</td>
                    <td className="py-2 font-mono text-xs text-ink-muted">{shortHash(artifact.sha256)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">{i18n.t("runDetail.noArtifactChecksums")}</p>
        )}
      </RunCardPanel>
    </div>
  );
}

function RunCardStat({ label, value, tone = "normal" }: { label: string; value: string; tone?: "normal" | "warning" }) {
  return (
    <div className="min-w-0 border-r border-[hsl(var(--border-subtle))] px-4 py-4 last:border-r-0">
      <div className="text-xs text-ink-muted">{label}</div>
      <div className={cn("mt-1 truncate text-sm font-semibold text-ink-strong", tone === "warning" && "text-warning")} title={value}>{value}</div>
    </div>
  );
}

function RunCardPanel({ title, icon: Icon, children }: { title: string; icon: typeof FileCheck2; children: ReactNode }) {
  return (
    <Panel className="shadow-xs">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-ink-strong">
        <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
        {title}
      </div>
      {children}
    </Panel>
  );
}

function KeyValueTable({ data, empty, monospaceValues = false }: { data: Record<string, unknown>; empty: string; monospaceValues?: boolean }) {
  const entries = Object.entries(data).filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (entries.length === 0) {
    return <p className="text-sm text-ink-muted">{empty}</p>;
  }
  return (
    <table className="w-full table-fixed text-sm">
      <tbody>
        {entries.map(([key, value]) => (
          <tr key={key} className="border-b border-[hsl(var(--border-subtle))] last:border-0">
            <td className="w-36 py-2 pr-4 align-top text-ink-muted">{key}</td>
            <td className={cn("py-2 align-top", monospaceValues ? "break-all font-mono text-xs" : "break-words text-right tabular-nums")}>{formatRunCardValue(value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function formatRunCardValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(4);
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value ?? "");
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function shortHash(value: string): string {
  return value.length > 16 ? `${value.slice(0, 12)}...${value.slice(-6)}` : value;
}

function ChartTab({
  run,
  chartPickerSymbol,
  selectedSymbols,
  chartCache,
  loadingSymbols,
  bulkLoading,
  bulkProgress,
  onPickSymbol,
  onAddSymbol,
  onCurrentOnly,
  onRemoveSymbol,
  onLoadAll,
  onCancelLoadAll,
}: {
  run: RunData;
  chartPickerSymbol: string;
  selectedSymbols: string[];
  chartCache: ChartCache;
  loadingSymbols: Record<string, boolean>;
  bulkLoading: boolean;
  bulkProgress: ChartLoadProgress;
  onPickSymbol: (symbol: string) => void;
  onAddSymbol: (symbol: string) => void | Promise<void>;
  onCurrentOnly: (symbol: string) => void | Promise<void>;
  onRemoveSymbol: (symbol: string) => void;
  onLoadAll: () => void | Promise<void>;
  onCancelLoadAll: () => void;
}) {
  const chartSymbols = run.chart_symbols || Object.keys(run.price_series || {});
  const entries = selectedSymbols
    .map((symbol) => [symbol, chartCache[symbol]?.price_series?.[symbol] || []] as const)
    .filter(([, bars]) => bars.length > 0);
  const hasEquity = run.equity_curve && run.equity_curve.length > 0;
  const progressPercent = bulkProgress.total > 0 ? Math.round((bulkProgress.done / bulkProgress.total) * 100) : 0;

  if (chartSymbols.length === 0 && entries.length === 0 && !hasEquity) {
    return (
      <Panel className="py-12 text-center shadow-xs">
        <BarChart3 className="mx-auto h-6 w-6 text-ink-muted" aria-hidden="true" />
        <h2 className="mt-3 text-sm font-semibold text-ink-strong">{i18n.t("runDetail.noChartData")}</h2>
        <p className="mx-auto mt-1 max-w-lg text-sm leading-6 text-ink-muted">{i18n.t("runDetail.noChartDataDesc")}</p>
      </Panel>
    );
  }

  return (
    <div className="space-y-5">
      {chartSymbols.length > 0 && (
        <Panel padding="none" className="overflow-visible shadow-xs">
          <div className="px-4 py-4 sm:px-5">
            <SectionHeader title={i18n.t("runDetail.chartWorkspace")} description={i18n.t("runDetail.chartWorkspaceDescription")} />
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-[hsl(var(--border-subtle))] bg-surface-2/45 px-4 py-3 sm:px-5">
            <Select
              value={chartPickerSymbol}
              onValueChange={onPickSymbol}
              options={chartSymbols.map((symbol) => ({ value: symbol, label: symbol }))}
              label={i18n.t("runDetail.symbol")}
              searchable={chartSymbols.length > 8}
              searchPlaceholder={i18n.t("runDetail.searchSymbols")}
              className="w-40"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onCurrentOnly(chartPickerSymbol)}
              disabled={!chartPickerSymbol || !!loadingSymbols[chartPickerSymbol]}
              loading={!!loadingSymbols[chartPickerSymbol]}
              loadingLabel={i18n.t("runDetail.loadingSelectedChart")}
            >
              {i18n.t("runDetail.showOnly")}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onAddSymbol(chartPickerSymbol)}
              disabled={!chartPickerSymbol || !!loadingSymbols[chartPickerSymbol]}
            >
              {i18n.t("runDetail.addSymbol")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void onLoadAll()}
              disabled={bulkLoading}
              loading={bulkLoading}
              loadingLabel={i18n.t("runDetail.loadingCharts")}
            >
              {i18n.t("runDetail.loadAll")}
            </Button>
            {bulkLoading && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onCancelLoadAll}
              >
                {i18n.t("runDetail.cancelLoad")}
              </Button>
            )}
          </div>
          {selectedSymbols.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-t border-[hsl(var(--border-subtle))] px-4 py-3 sm:px-5">
              <span className="text-xs font-medium text-ink-muted">{i18n.t("runDetail.selectedSymbols")}</span>
              {selectedSymbols.map((symbol) => (
                <button
                  key={symbol}
                  onClick={() => onRemoveSymbol(symbol)}
                  aria-label={i18n.t("runDetail.removeSymbol", { symbol })}
                  title={i18n.t("runDetail.removeSymbol", { symbol })}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface-2 px-2 text-xs font-medium text-ink transition-[color,background-color,border-color] duration-fast hover:border-primary/30 hover:bg-primary/6 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                >
                  {symbol} <X className="h-3 w-3" aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
          {bulkLoading && (
            <div className="border-t border-[hsl(var(--border-subtle))] px-4 py-3 sm:px-5">
              <Progress value={progressPercent} label={`${i18n.t("runDetail.loadingCharts")} ${bulkProgress.done}/${bulkProgress.total}`} showValue />
            </div>
          )}
        </Panel>
      )}
      {entries.length === 0 && (
        <div className="rounded-lg border border-dashed border-border px-5 py-10 text-center text-sm text-ink-muted">
          {Object.keys(loadingSymbols).length > 0 ? i18n.t("runDetail.loadingSelectedChart") : i18n.t("runDetail.pickSymbolToLoad")}
        </div>
      )}
      {entries.map(([sym, bars]) => (
        <Panel key={sym} padding="none" className="overflow-hidden shadow-xs">
          <div className="border-b border-[hsl(var(--border-subtle))] px-4 py-3 sm:px-5">
            <h3 className="font-mono text-sm font-semibold text-ink-strong">{sym}</h3>
          </div>
          <CandlestickChart data={bars} markers={chartCache[sym]?.trade_markers?.filter(m => m.code === sym)} indicators={chartCache[sym]?.indicator_series?.[sym]} height={500} />
        </Panel>
      ))}
      {hasEquity && (
        <Panel padding="none" className="overflow-hidden shadow-xs">
          <div className="border-b border-[hsl(var(--border-subtle))] px-4 py-3 sm:px-5">
            <h3 className="text-sm font-semibold text-ink-strong">{i18n.t("runDetail.equityDrawdown")}</h3>
          </div>
          <EquityChart data={run.equity_curve!} height={280} />
        </Panel>
      )}
    </div>
  );
}

function TradesTab({ run }: { run: RunData }) {
  const trades = run.trade_log || [];
  if (trades.length === 0) return (
    <Panel className="py-12 text-center shadow-xs">
      <List className="mx-auto h-6 w-6 text-ink-muted" aria-hidden="true" />
      <p className="mt-3 text-sm text-ink-muted">{i18n.t("runDetail.noTrades")}</p>
    </Panel>
  );
  return (
    <Panel padding="none" className="overflow-hidden shadow-xs">
      <div className="px-4 py-4 sm:px-5">
        <SectionHeader
          title={i18n.t("runDetail.tradeLedger")}
          description={i18n.t("runDetail.tradeLedgerDescription")}
          actions={<StatusIndicator label={i18n.t("runDetail.tradeRows", { count: trades.length })} tone="neutral" />}
        />
      </div>
      <div className="overflow-x-auto border-t border-[hsl(var(--border-subtle))]">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="bg-surface-2/55 text-left text-xs text-ink-muted">
              <th className="px-5 py-2.5 font-medium">{i18n.t("runDetail.time")}</th>
              <th className="px-3 py-2.5 font-medium">{i18n.t("runDetail.code2")}</th>
              <th className="px-3 py-2.5 font-medium">{i18n.t("runDetail.side")}</th>
              <th className="px-3 py-2.5 text-right font-medium">{i18n.t("runDetail.price")}</th>
              <th className="px-3 py-2.5 text-right font-medium">{i18n.t("runDetail.qty")}</th>
              <th className="px-5 py-2.5 font-medium">{i18n.t("runDetail.reason")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[hsl(var(--border-subtle))]">
            {trades.map((tr, i) => (
              <tr key={i} className="transition-colors duration-fast hover:bg-surface-2/45">
                <td className="whitespace-nowrap px-5 py-3 font-mono text-xs text-ink-muted">{tr.time || tr.timestamp}</td>
                <td className="px-3 py-3 font-mono text-xs font-semibold text-ink-strong">{tr.code}</td>
                <td className="px-3 py-3"><StatusIndicator label={tr.side || i18n.t("runDetail.unknown")} tone={tr.side === "BUY" ? "success" : "danger"} /></td>
                <td className="px-3 py-3 text-right font-mono tabular-nums text-ink-strong">{tr.price}</td>
                <td className="px-3 py-3 text-right font-mono tabular-nums text-ink-strong">{tr.qty}</td>
                <td className="px-5 py-3 text-ink-muted">{tr.reason || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function ArtifactsTab({ run }: { run: RunData }) {
  const runtimeArtifacts = run.artifacts || [];
  const checksumArtifacts = run.run_card?.artifacts || [];
  const rows = runtimeArtifacts.length > 0
    ? runtimeArtifacts.map((artifact) => ({
        name: artifact.name,
        path: artifact.path,
        type: artifact.type,
        size: artifact.size,
        exists: artifact.exists,
        checksum: "",
      }))
    : checksumArtifacts.map((artifact) => ({
        name: artifact.path.split(/[\\/]/).pop() || artifact.path,
        path: artifact.path,
        type: i18n.t("runDetail.checksumArtifact"),
        size: artifact.size_bytes,
        exists: true,
        checksum: artifact.sha256,
      }));

  if (!rows.length) return (
    <Panel className="py-12 text-center shadow-xs">
      <Box className="mx-auto h-6 w-6 text-ink-muted" aria-hidden="true" />
      <p className="mt-3 text-sm text-ink-muted">{i18n.t("runDetail.noArtifacts")}</p>
    </Panel>
  );

  return (
    <Panel padding="none" className="overflow-hidden shadow-xs">
      <div className="px-4 py-4 sm:px-5">
        <SectionHeader
          title={i18n.t("runDetail.artifactInventory")}
          description={i18n.t("runDetail.artifactInventoryDescription")}
          actions={<StatusIndicator label={i18n.t("runDetail.artifactRows", { count: rows.length })} tone="neutral" />}
        />
      </div>
      <div className="overflow-x-auto border-t border-[hsl(var(--border-subtle))]">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="bg-surface-2/55 text-left text-xs text-ink-muted">
              <th className="px-5 py-2.5 font-medium">{i18n.t("runDetail.artifactName")}</th>
              <th className="px-3 py-2.5 font-medium">{i18n.t("runDetail.path")}</th>
              <th className="px-3 py-2.5 font-medium">{i18n.t("runDetail.type")}</th>
              <th className="px-3 py-2.5 text-right font-medium">{i18n.t("runDetail.size")}</th>
              <th className="px-5 py-2.5 font-medium">{i18n.t("runDetail.availability")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[hsl(var(--border-subtle))]">
            {rows.map((artifact) => (
              <tr key={`${artifact.path}-${artifact.checksum}`} className="transition-colors duration-fast hover:bg-surface-2/45">
                <td className="px-5 py-3 font-medium text-ink-strong">{artifact.name}</td>
                <td className="max-w-xs truncate px-3 py-3 font-mono text-xs text-ink-muted" title={artifact.path}>{artifact.path}</td>
                <td className="px-3 py-3 text-ink-muted">{artifact.type || "-"}</td>
                <td className="px-3 py-3 text-right font-mono text-xs tabular-nums text-ink">{formatBytes(artifact.size)}</td>
                <td className="px-5 py-3"><StatusIndicator label={artifact.exists ? i18n.t("runDetail.available") : i18n.t("runDetail.missing")} tone={artifact.exists ? "success" : "danger"} dot /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function LogsTab({ logs }: { logs: NonNullable<RunData["run_logs"]> }) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  if (!logs.length) return (
    <Panel className="py-12 text-center shadow-xs">
      <ScrollText className="mx-auto h-6 w-6 text-ink-muted" aria-hidden="true" />
      <p className="mt-3 text-sm text-ink-muted">{i18n.t("runDetail.noLogs")}</p>
    </Panel>
  );

  const copyLog = async (message: string, index: number) => {
    await navigator.clipboard.writeText(message);
    setCopiedIndex(index);
    window.setTimeout(() => setCopiedIndex((current) => current === index ? null : current), 1500);
  };

  return (
    <Panel padding="none" className="overflow-hidden shadow-xs">
      <div className="px-4 py-4 sm:px-5">
        <SectionHeader
          title={i18n.t("runDetail.executionLogs")}
          description={i18n.t("runDetail.executionLogsDescription")}
          actions={<StatusIndicator label={i18n.t("runDetail.logRows", { count: logs.length })} tone="neutral" />}
        />
      </div>
      <div className="divide-y divide-[hsl(var(--border-subtle))] border-t border-[hsl(var(--border-subtle))]">
        {logs.map((log, index) => {
          const message = log.message || "";
          const canExpand = message.length > 240 || message.includes("\n");
          const isExpanded = Boolean(expanded[index]);
          return (
            <article key={`${log.source || "log"}-${log.line_number || index}-${index}`} className="px-4 py-4 transition-colors duration-fast hover:bg-surface-2/35 sm:px-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <StatusIndicator label={log.source || i18n.t("runDetail.systemLog")} tone="neutral" />
                  {log.line_number != null ? <span className="font-mono text-xs text-ink-muted">{i18n.t("runDetail.line", { line: log.line_number })}</span> : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <IconButton label={copiedIndex === index ? i18n.t("runDetail.copied") : i18n.t("runDetail.copy")} onClick={() => void copyLog(message, index)}>
                    <Clipboard className="h-3.5 w-3.5" />
                  </IconButton>
                  {canExpand ? (
                    <IconButton
                      label={isExpanded ? i18n.t("runDetail.collapse") : i18n.t("runDetail.expand")}
                      onClick={() => setExpanded((current) => ({ ...current, [index]: !current[index] }))}
                    >
                      {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </IconButton>
                  ) : null}
                </div>
              </div>
              <pre
                className={cn(
                  "mt-2 whitespace-pre-wrap break-words rounded-md border border-border bg-surface-2/65 p-3 font-mono text-xs leading-5 text-ink transition-[max-height] duration-slow ease-standard",
                  isExpanded ? "max-h-[32rem] overflow-auto" : "max-h-24 overflow-hidden",
                )}
              >
                {message || i18n.t("runDetail.emptyLogMessage")}
              </pre>
            </article>
          );
        })}
      </div>
    </Panel>
  );
}

function CodeTab({ code }: { code: Record<string, string> }) {
  const files = Object.entries(code);
  const [active, setActive] = useState(files[0]?.[0] || "");
  const [copied, setCopied] = useState(false);
  if (files.length === 0) return (
    <Panel className="py-12 text-center shadow-xs">
      <Code2 className="mx-auto h-6 w-6 text-ink-muted" aria-hidden="true" />
      <p className="mt-3 text-sm text-ink-muted">{i18n.t("runDetail.noCodeFiles")}</p>
    </Panel>
  );

  const copyCode = async () => {
    await navigator.clipboard.writeText(code[active] || "");
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Panel padding="none" className="overflow-hidden shadow-xs">
      <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <SectionHeader title={i18n.t("runDetail.generatedCode")} description={i18n.t("runDetail.generatedCodeDescription")} />
        <Button variant="secondary" size="sm" onClick={() => void copyCode()} leftIcon={<Clipboard className="h-3.5 w-3.5" />}>
          {copied ? i18n.t("runDetail.copied") : i18n.t("runDetail.copy")}
        </Button>
      </div>
      <div className="flex gap-1 overflow-x-auto border-y border-[hsl(var(--border-subtle))] bg-surface-2/55 px-3 py-2">
        {files.map(([name]) => (
          <button
            key={name}
            onClick={() => setActive(name)}
            className={cn(
              "shrink-0 rounded-md px-3 py-1.5 font-mono text-xs transition-[color,background-color,box-shadow] duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
              active === name ? "bg-surface-1 text-primary shadow-xs" : "text-ink-muted hover:bg-surface-1/70 hover:text-ink-strong",
            )}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="max-h-[70vh] overflow-auto bg-surface-2/25 p-4 font-mono text-xs leading-relaxed text-ink [&_pre]:m-0 [&_pre]:bg-transparent [&_code]:text-xs">
        <ReactMarkdown rehypePlugins={rehypePlugins}>
          {`\`\`\`python\n${code[active] || ""}\n\`\`\``}
        </ReactMarkdown>
      </div>
    </Panel>
  );
}

function runStatusTone(status: string): StatusTone {
  const normalized = (status || "unknown").toLowerCase();
  if (["success", "done", "completed", "complete"].includes(normalized)) return "success";
  if (["failed", "error", "cancelled", "canceled"].includes(normalized)) return "danger";
  if (["running", "processing"].includes(normalized)) return "info";
  if (["pending", "queued", "waiting"].includes(normalized)) return "warning";
  return "neutral";
}

function runStatusLabel(status: string, t: TFunction): string {
  const normalized = (status || "unknown").toLowerCase();
  if (["success", "done", "completed", "complete"].includes(normalized)) return t("runDetail.status.completed");
  if (["failed", "error"].includes(normalized)) return t("runDetail.status.failed");
  if (["cancelled", "canceled"].includes(normalized)) return t("runDetail.status.cancelled");
  if (["running", "processing"].includes(normalized)) return t("runDetail.status.running");
  if (["pending", "queued", "waiting"].includes(normalized)) return t("runDetail.status.pending");
  return status || t("runDetail.status.unknown");
}

function formatElapsed(value: number | undefined): string {
  if (!Number.isFinite(value)) return "-";
  const seconds = Number(value);
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}
