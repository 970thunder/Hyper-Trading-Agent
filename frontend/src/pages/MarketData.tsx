import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { BarChart3, Database, History, LineChart, RefreshCw, Search, ServerCog, ShieldCheck } from "lucide-react";
import { CandlestickChart } from "@/components/charts/CandlestickChart";
import { Skeleton } from "@/components/common/Skeleton";
import { Button } from "@/components/ui/Button";
import { Metric, Panel, SectionHeader } from "@/components/ui/Panel";
import { Select, type SelectOption } from "@/components/ui/Select";
import { StatusIndicator } from "@/components/ui/Status";
import { Tab, TabList, TabPanel, Tabs } from "@/components/ui/Tabs";
import { useDarkMode } from "@/hooks/useDarkMode";
import { api, type MarketDataBar, type MarketDataHistoryResponse, type MarketDataSeries, type MarketDataSource, type MarketSymbolCandidate, type PriceBar } from "@/lib/api";
import { getChartTheme } from "@/lib/chart-theme";
import { echarts } from "@/lib/echarts";
import { cn } from "@/lib/utils";

type WorkspaceView = "history" | "compare" | "sources";
const DEFAULT_SYMBOLS = "BTC-USDT,AAPL.US,600519.SH";

function isoDate(date: Date) { return date.toISOString().slice(0, 10); }
function defaultStartDate() { const date = new Date(); date.setFullYear(date.getFullYear() - 1); return isoDate(date); }
function toPriceBars(series?: MarketDataSeries): PriceBar[] {
  if (!series) return [];
  return series.bars.map((bar: MarketDataBar) => ({ time: bar.trade_date.slice(0, 10), open: Number(bar.open ?? bar.close ?? 0), high: Number(bar.high ?? bar.close ?? 0), low: Number(bar.low ?? bar.close ?? 0), close: Number(bar.close ?? 0), volume: Number(bar.volume ?? 0) })).filter((bar) => Number.isFinite(bar.close) && bar.close > 0);
}
function returnsFor(series: MarketDataSeries) { const values = toPriceBars(series).map((bar) => bar.close); return values.length < 2 ? null : (values[values.length - 1] / values[0] - 1) * 100; }
function formatPercent(value: number | null) { return value === null ? "-" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`; }
function sourceTone(source: MarketDataSource) { return source.available ? "success" : source.requires_auth ? "warning" : "neutral"; }
function marketLabel(market: string, labels: Record<string, string>) { return labels[market] || market.replace(/_/g, " "); }

export function MarketData() {
  const { t } = useTranslation();
  const { hash } = useLocation();
  const { dark } = useDarkMode();
  const [view, setView] = useState<WorkspaceView>(hash === "#sources" ? "sources" : "history");
  const [symbols, setSymbols] = useState(DEFAULT_SYMBOLS);
  const [start, setStart] = useState(defaultStartDate);
  const [end, setEnd] = useState(() => isoDate(new Date()));
  const [source, setSource] = useState("auto");
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [response, setResponse] = useState<MarketDataHistoryResponse | null>(null);
  const [sources, setSources] = useState<MarketDataSource[]>([]);
  const [fallbackChains, setFallbackChains] = useState<Record<string, string[]>>({});
  const [cachePolicy, setCachePolicy] = useState("");
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [symbolMatches, setSymbolMatches] = useState<MarketSymbolCandidate[]>([]);
  const requestId = useRef(0);

  const loadSources = useCallback(async () => {
    setSourcesLoading(true);
    try {
      const data = await api.listMarketDataSources();
      setSources(Array.isArray(data.sources) ? data.sources : []);
      setFallbackChains(data.fallback_chains || {});
      setCachePolicy(data.cache.policy || "");
    } catch { setError(t("marketData.errors.sources")); }
    finally { setSourcesLoading(false); }
  }, [t]);

  useEffect(() => { void loadSources(); }, [loadSources]);
  useEffect(() => { if (hash === "#sources") setView("sources"); }, [hash]);
  useEffect(() => {
    const query = symbols.split(/[\s,;]+/).slice(-1)[0]?.trim() || "";
    if (query.length < 2) { setSymbolMatches([]); return; }
    const timer = window.setTimeout(() => {
      void api.searchMarketSymbols(query).then((result) => setSymbolMatches(result.candidates || [])).catch(() => setSymbolMatches([]));
    }, 280);
    return () => window.clearTimeout(timer);
  }, [symbols]);

  const symbolList = useMemo(() => Array.from(new Set(symbols.split(/[\s,;]+/).map((item) => item.trim().toUpperCase()).filter(Boolean))), [symbols]);
  const sourceOptions = useMemo<SelectOption[]>(() => [
    { value: "auto", label: t("marketData.auto"), description: t("marketData.autoDescription") },
    ...sources.map((item) => ({ value: item.id, label: item.label, description: item.markets.join(", ") || t("marketData.general"), badge: item.available ? t("marketData.available") : item.requires_auth ? t("marketData.setupNeeded") : t("marketData.unavailable") })),
  ], [sources, t]);
  const seriesOptions = useMemo<SelectOption[]>(() => (response?.series || []).map((item) => ({ value: item.symbol, label: item.symbol, description: `${item.source} | ${t("marketData.barCount", { count: item.quality.source_bars })}` })), [response, t]);
  const activeSeries = useMemo(() => response?.series.find((item) => item.symbol === selectedSymbol) || response?.series[0], [response, selectedSymbol]);
  const priceBars = useMemo(() => toPriceBars(activeSeries), [activeSeries]);

  const fetchHistory = async () => {
    if (!symbolList.length) { setError(t("marketData.errors.noSymbols")); return; }
    if (start > end) { setError(t("marketData.errors.invalidDates")); return; }
    const id = ++requestId.current;
    setLoading(true); setError(null);
    try {
      const data = await api.getMarketDataHistory({ symbols: symbolList, start, end, source, interval: "1D", max_rows: 2000 });
      if (id !== requestId.current) return;
      setResponse(data);
      setSelectedSymbol((current) => data.series.some((item) => item.symbol === current) ? current : data.series[0]?.symbol || "");
      if (!data.series.length) setError(t("marketData.errors.noData"));
    } catch { if (id === requestId.current) setError(t("marketData.errors.request")); }
    finally { if (id === requestId.current) setLoading(false); }
  };

  const loadedSeries = response?.series || [];
  const loadedSources = new Set(loadedSeries.map((item) => item.source));
  return <div data-page-enter className="min-h-full bg-canvas px-4 py-5 sm:px-6 sm:py-6 lg:px-8"><div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
    <header className="border-b border-[hsl(var(--border-subtle))] pb-5"><div className="mb-2 flex items-center gap-2 text-xs font-medium text-primary"><LineChart className="h-3.5 w-3.5" />{t("marketData.navigation")}</div><h1 className="text-2xl font-semibold leading-8 text-ink-strong">{t("marketData.title")}</h1><p className="mt-1 max-w-3xl text-sm leading-6 text-ink-muted">{t("marketData.subtitle")}</p></header>
    <Panel padding="none" className="overflow-visible shadow-xs"><div className="px-4 py-4 sm:px-5"><SectionHeader title={t("marketData.query")} description={t("marketData.queryDescription")} /></div><div className="grid gap-4 border-t border-[hsl(var(--border-subtle))] bg-surface-2/45 px-4 py-4 sm:px-5 lg:grid-cols-[minmax(0,1.7fr)_repeat(3,minmax(0,0.75fr))_auto] lg:items-end">
      <label className="grid gap-1.5"><span className="text-sm font-medium text-ink-strong">{t("marketData.symbols")}</span><div className="relative"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-muted" /><input value={symbols} onChange={(event) => setSymbols(event.target.value)} className="h-9 w-full rounded-md border border-border bg-surface-1 pl-9 pr-3 text-sm text-ink-strong shadow-xs outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/20" />{symbolMatches.length ? <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-surface-1 py-1 shadow-lg">{symbolMatches.map((item) => <button key={item.symbol} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setSymbols((current) => current.replace(/[^,;\s]*$/, item.symbol)); setSymbolMatches([]); }} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface-2"><span className="min-w-0"><span className="font-medium text-ink-strong">{item.symbol}</span>{item.name ? <span className="ml-2 truncate text-ink-muted">{item.name}</span> : null}<span className="ml-2 text-xs text-ink-muted">{item.session || item.timezone || ""}</span></span><span className="shrink-0 text-xs text-ink-muted">{item.exchange || item.market || item.type || ""}</span></button>)}</div> : null}</div></label>
      <label className="grid gap-1.5"><span className="text-sm font-medium text-ink-strong">{t("marketData.start")}</span><input type="date" value={start} max={end} onChange={(event) => setStart(event.target.value)} className="h-9 rounded-md border border-border bg-surface-1 px-3 text-sm text-ink-strong shadow-xs outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/20" /></label>
      <label className="grid gap-1.5"><span className="text-sm font-medium text-ink-strong">{t("marketData.end")}</span><input type="date" value={end} min={start} max={isoDate(new Date())} onChange={(event) => setEnd(event.target.value)} className="h-9 rounded-md border border-border bg-surface-1 px-3 text-sm text-ink-strong shadow-xs outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-primary/20" /></label>
      <div className="grid gap-1.5"><span className="text-sm font-medium text-ink-strong">{t("marketData.source")}</span><Select value={source} onValueChange={setSource} options={sourceOptions} label={t("marketData.source")} searchable searchPlaceholder={t("marketData.searchSources")} className="w-full" /></div>
      <Button variant="primary" onClick={() => void fetchHistory()} loading={loading} loadingLabel={t("marketData.loading")} leftIcon={loading ? undefined : <RefreshCw className="h-4 w-4" />}>{t("marketData.load")}</Button>
    </div></Panel>
    {error ? <MarketDataError message={error} canRetry={Boolean(response)} onRetry={() => void fetchHistory()} /> : null}
    <Tabs value={view} onValueChange={(value) => setView(value as WorkspaceView)}><TabList className="w-fit max-w-full"><Tab value="history"><History className="h-3.5 w-3.5" />{t("marketData.history")}</Tab><Tab value="compare"><BarChart3 className="h-3.5 w-3.5" />{t("marketData.compare")}</Tab><Tab value="sources"><ServerCog className="h-3.5 w-3.5" />{t("marketData.sources")}</Tab></TabList>
      <TabPanel value="history" className="mt-4">{loading ? <ChartLoading /> : activeSeries ? <HistoryWorkspace series={activeSeries} options={seriesOptions} selectedSymbol={activeSeries.symbol} onSelectedSymbol={setSelectedSymbol} bars={priceBars} queryCache={response?.query_cache} /> : <MarketDataEmpty title={t("marketData.noQuery")} description={t("marketData.noQueryDescription")} />}</TabPanel>
      <TabPanel value="compare" className="mt-4">{loading ? <ChartLoading /> : loadedSeries.length >= 2 ? <ComparisonWorkspace series={loadedSeries} dark={dark} /> : <MarketDataEmpty title={t("marketData.twoAssets")} description={t("marketData.twoAssetsDescription")} />}</TabPanel>
      <TabPanel value="sources" className="mt-4"><SourcesWorkspace sources={sources} fallbackChains={fallbackChains} cachePolicy={cachePolicy} loading={sourcesLoading} loadedSources={loadedSources} onRefresh={() => void loadSources()} /></TabPanel>
    </Tabs>
  </div></div>;
}

function HistoryWorkspace({ series, options, selectedSymbol, onSelectedSymbol, bars, queryCache }: { series: MarketDataSeries; options: SelectOption[]; selectedSymbol: string; onSelectedSymbol: (symbol: string) => void; bars: PriceBar[]; queryCache?: MarketDataHistoryResponse["query_cache"] }) { const { t, i18n } = useTranslation(); const cacheValue = queryCache ? t(queryCache.status === "hit" ? "marketData.queryCacheHit" : "marketData.queryCacheMiss") : null; const cacheDescription = queryCache ? t("marketData.queryCacheDescription", { savedAt: new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(queryCache.saved_at)), ttl: queryCache.ttl_seconds === null ? t("marketData.noExpiry") : t("marketData.seconds", { count: queryCache.ttl_seconds }) }) : null; const cacheOrigin = queryCache?.origin === "prewarm" ? ` ${t("marketData.prewarmed")}` : ""; return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_17rem]"><Panel padding="none" className="overflow-hidden shadow-xs"><div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5"><SectionHeader title={series.symbol} description={`${t("marketData.actualSource")}: ${series.source}${series.requested_source !== series.source ? ` (${t("marketData.requested")} ${series.requested_source})` : ""}`} /><Select value={selectedSymbol} onValueChange={onSelectedSymbol} options={options} label={t("marketData.chartAsset")} className="w-full sm:w-52" /></div><div className="border-t border-[hsl(var(--border-subtle))] p-2 sm:p-4"><CandlestickChart data={bars} height={460} /></div></Panel><div className="grid content-start gap-3"><QualityPanel series={series} />{queryCache ? <Panel padding="md"><div className="flex items-start gap-3"><Database className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div className="text-sm"><div className="font-medium text-ink-strong">{t("marketData.queryCache")}</div><p className="mt-1 leading-5 text-ink-muted">{cacheValue}.{cacheOrigin} {cacheDescription}</p></div></div></Panel> : null}<Panel padding="md"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div className="text-sm"><div className="font-medium text-ink-strong">{t("marketData.auditedQueries")}</div><p className="mt-1 leading-5 text-ink-muted">{t("marketData.auditedQueriesDescription")}</p></div></div></Panel></div></div>; }

function QualityPanel({ series }: { series: MarketDataSeries }) { const { t } = useTranslation(); const { quality } = series; return <Panel padding="none" className="overflow-hidden shadow-xs"><div className="px-4 py-4"><SectionHeader title={t("marketData.dataQuality")} actions={<StatusIndicator label={quality.status === "complete" ? t("marketData.complete") : t("marketData.partial")} tone={quality.status === "complete" ? "success" : "warning"} dot />} /></div><div className="grid grid-cols-2 border-t border-[hsl(var(--border-subtle))]"><Metric label={t("marketData.sourceBars")} value={String(quality.source_bars)} className="border-b border-r border-[hsl(var(--border-subtle))] px-4 py-3" /><Metric label={t("marketData.cache")} value={series.cache_hit ? t("marketData.hit") : t("marketData.live")} className="border-b border-[hsl(var(--border-subtle))] px-4 py-3" /><Metric label={t("marketData.firstBar")} value={quality.first_bar?.slice(0, 10) || "-"} className="border-r border-[hsl(var(--border-subtle))] px-4 py-3" /><Metric label={t("marketData.maxGap")} value={t("marketData.days", { count: quality.max_gap_days })} className="px-4 py-3" /></div>{quality.truncated ? <p className="border-t border-warning/20 bg-warning/5 px-4 py-3 text-xs leading-5 text-warning">{t("marketData.truncated")}</p> : null}</Panel>; }

function ComparisonWorkspace({ series, dark }: { series: MarketDataSeries[]; dark: boolean }) { const { t } = useTranslation(); return <div className="grid gap-5"><Panel padding="none" className="overflow-hidden shadow-xs"><div className="px-4 py-4 sm:px-5"><SectionHeader title={t("marketData.normalizedPerformance")} description={t("marketData.normalizedDescription")} /></div><div className="border-t border-[hsl(var(--border-subtle))] p-2 sm:p-4"><NormalizedPerformanceChart series={series} dark={dark} /></div></Panel><Panel padding="none" className="overflow-hidden shadow-xs"><div className="px-4 py-4 sm:px-5"><SectionHeader title={t("marketData.comparisonSummary")} /></div><div className="overflow-x-auto border-t border-[hsl(var(--border-subtle))]"><table className="w-full min-w-[680px] text-sm"><thead><tr className="bg-surface-2/55 text-xs text-ink-muted"><th className="px-5 py-2.5 text-left font-medium">{t("marketData.asset")}</th><th className="px-4 py-2.5 text-left font-medium">{t("marketData.actualSource")}</th><th className="px-4 py-2.5 text-right font-medium">{t("marketData.return")}</th><th className="px-4 py-2.5 text-right font-medium">{t("marketData.bars")}</th><th className="px-5 py-2.5 text-right font-medium">{t("marketData.cache")}</th></tr></thead><tbody className="divide-y divide-[hsl(var(--border-subtle))]">{series.map((item) => { const value = returnsFor(item); return <tr key={item.symbol} className="hover:bg-surface-2/45"><td className="px-5 py-3 font-medium text-ink-strong">{item.symbol}</td><td className="px-4 py-3 text-ink-muted">{item.source}{item.requested_source !== item.source ? ` (${t("marketData.requested")} ${item.requested_source})` : ""}</td><td className={cn("px-4 py-3 text-right font-mono font-semibold tabular-nums", (value || 0) >= 0 ? "text-success" : "text-danger")}>{formatPercent(value)}</td><td className="px-4 py-3 text-right font-mono tabular-nums text-ink">{item.quality.source_bars}</td><td className="px-5 py-3 text-right text-ink-muted">{item.cache_hit ? t("marketData.hit") : t("marketData.live")}</td></tr>; })}</tbody></table></div></Panel></div>; }

function NormalizedPerformanceChart({ series, dark }: { series: MarketDataSeries[]; dark: boolean }) { const { t } = useTranslation(); const ref = useRef<HTMLDivElement>(null); useEffect(() => { if (!ref.current) return; const chart = echarts.init(ref.current); const theme = getChartTheme(); const dates = Array.from(new Set(series.flatMap((item) => toPriceBars(item).map((bar) => bar.time)))).sort(); chart.setOption({ backgroundColor: "transparent", color: ["#0f8b8d", "#c65d3b", "#4361ee", "#7c3aed", "#2f855a", "#b45309"], tooltip: { trigger: "axis", backgroundColor: theme.tooltipBg, borderColor: theme.tooltipBorder, textStyle: { color: theme.tooltipText, fontSize: 11 } }, legend: { data: series.map((item) => item.symbol), top: 4, type: "scroll", textStyle: { color: theme.textColor, fontSize: 11 } }, grid: { left: 8, right: 12, top: 38, bottom: 42, containLabel: true }, xAxis: { type: "category", data: dates, boundaryGap: false, axisLine: { lineStyle: { color: theme.axisColor } }, axisLabel: { color: theme.textColor, fontSize: 10 } }, yAxis: { type: "value", scale: true, axisLabel: { color: theme.textColor, fontSize: 10 }, splitLine: { lineStyle: { color: theme.gridColor } } }, dataZoom: [{ type: "inside" }, { type: "slider", bottom: 4, height: 20 }], series: series.map((item) => { const bars = toPriceBars(item); const first = bars[0]?.close || 1; const values = new Map(bars.map((bar) => [bar.time, (bar.close / first) * 100])); return { name: item.symbol, type: "line", data: dates.map((date) => values.get(date) ?? null), symbol: "none", connectNulls: true, lineStyle: { width: 2 } }; }) }); const observer = new ResizeObserver(() => chart.resize()); observer.observe(ref.current); return () => { observer.disconnect(); chart.dispose(); }; }, [dark, series]); return <div ref={ref} className="h-[440px] w-full" aria-label={t("marketData.normalizedChartLabel")} />; }

function SourcesWorkspace({ sources, fallbackChains, cachePolicy, loading, loadedSources, onRefresh }: { sources: MarketDataSource[]; fallbackChains: Record<string, string[]>; cachePolicy: string; loading: boolean; loadedSources: Set<string>; onRefresh: () => void }) { const { t } = useTranslation(); const marketLabels = { a_share: t("marketData.marketLabels.a_share"), us_equity: t("marketData.marketLabels.us_equity"), hk_equity: t("marketData.marketLabels.hk_equity"), crypto: t("marketData.marketLabels.crypto"), forex: t("marketData.marketLabels.forex"), fund: t("marketData.marketLabels.fund"), futures: t("marketData.marketLabels.futures"), macro: t("marketData.marketLabels.macro") }; if (loading) return <div className="grid gap-4"><Skeleton className="h-44" /><Skeleton className="h-72" /></div>; return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]"><Panel padding="none" className="overflow-hidden shadow-xs"><div className="px-4 py-4 sm:px-5"><SectionHeader title={t("marketData.registeredSources")} description={t("marketData.registeredSourcesDescription")} actions={<Button variant="outline" size="sm" onClick={onRefresh} leftIcon={<RefreshCw className="h-3.5 w-3.5" />}>{t("marketData.refresh")}</Button>} /></div><div className="overflow-x-auto border-t border-[hsl(var(--border-subtle))]"><table className="w-full min-w-[760px] text-sm"><thead><tr className="bg-surface-2/55 text-xs text-ink-muted"><th className="px-5 py-2.5 text-left font-medium">{t("marketData.source")}</th><th className="px-4 py-2.5 text-left font-medium">{t("marketData.status")}</th><th className="px-4 py-2.5 text-left font-medium">{t("marketData.markets")}</th><th className="px-5 py-2.5 text-left font-medium">{t("marketData.fallbackMarkets")}</th></tr></thead><tbody className="divide-y divide-[hsl(var(--border-subtle))]">{sources.map((item) => <tr key={item.id} className={cn("hover:bg-surface-2/45", loadedSources.has(item.id) && "bg-primary/5")}><td className="px-5 py-3"><div className="font-medium text-ink-strong">{item.label}</div><div className="mt-0.5 font-mono text-xs text-ink-muted">{item.id}</div></td><td className="px-4 py-3"><StatusIndicator label={item.available ? t("marketData.available") : item.requires_auth ? t("marketData.setupNeeded") : t("marketData.unavailable")} tone={sourceTone(item)} dot /></td><td className="px-4 py-3 text-ink-muted">{item.markets.map((market) => marketLabel(market, marketLabels)).join(", ") || "-"}</td><td className="px-5 py-3 text-ink-muted">{item.fallback_markets.map((market) => marketLabel(market, marketLabels)).join(", ") || "-"}</td></tr>)}</tbody></table></div></Panel><div className="grid content-start gap-3"><Panel padding="md"><div className="flex items-start gap-3"><Database className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div><div className="text-sm font-medium text-ink-strong">{t("marketData.localCache")}</div><p className="mt-1 text-sm leading-5 text-ink-muted">{cachePolicy ? t("marketData.cachePolicy") : t("marketData.cacheLoading")}</p></div></div></Panel><Panel padding="none" className="overflow-hidden"><div className="px-4 py-4"><SectionHeader title={t("marketData.fallbackOrder")} description={t("marketData.fallbackDescription")} /></div><div className="divide-y divide-[hsl(var(--border-subtle))]">{Object.entries(fallbackChains).map(([market, chain]) => <div key={market} className="px-4 py-3"><div className="text-xs font-medium text-ink-strong">{marketLabel(market, marketLabels)}</div><div className="mt-1 break-words text-xs leading-5 text-ink-muted">{chain.join(" -> ")}</div></div>)}</div></Panel></div></div>; }
function ChartLoading() { return <Panel padding="md" className="space-y-4"><Skeleton className="h-5 w-[35%]" /><Skeleton className="h-[440px]" /></Panel>; }
function MarketDataEmpty({ title, description }: { title: string; description: string }) { return <Panel className="py-12 text-center shadow-xs"><h2 className="text-sm font-semibold text-ink-strong">{title}</h2><p className="mx-auto mt-1 max-w-lg text-sm leading-6 text-ink-muted">{description}</p></Panel>; }
function MarketDataError({ message, canRetry, onRetry }: { message: string; canRetry: boolean; onRetry: () => void }) { const { t } = useTranslation(); return <div role="alert" className="flex flex-col gap-3 rounded-lg border border-danger/25 bg-danger/5 p-4 text-sm sm:flex-row sm:items-center sm:justify-between"><p className="break-words text-ink">{message}</p>{canRetry ? <Button variant="outline" size="sm" onClick={onRetry}>{t("marketData.retry")}</Button> : null}</div>; }
