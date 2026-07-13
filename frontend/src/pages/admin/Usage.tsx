import { useEffect, useMemo, useState } from "react";
import { Gauge } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api, type ModelUsage } from "@/lib/api";
import { InlineError, Skeleton } from "@/components/ui/AsyncState";

export function Usage() {
  const { t } = useTranslation();
  const [usage, setUsage] = useState<ModelUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setError("");
    setUsage(await api.listModelUsage(1000));
  };

  useEffect(() => {
    let alive = true;
    load().catch((loadError) => { if (alive) setError(errorMessage(loadError)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const summary = useMemo(() => usage.reduce((current, row) => ({
    calls: current.calls + 1,
    tokens: current.tokens + Number(row.total_tokens || 0),
    cost: current.cost + Number(row.estimated_cost || 0),
    latency: current.latency + Number(row.latency_ms || 0),
  }), { calls: 0, tokens: 0, cost: 0, latency: 0 }), [usage]);

  const byModel = useMemo(() => {
    const grouped = new Map<string, { provider: string; model: string; calls: number; tokens: number; cost: number; latency: number }>();
    usage.forEach((row) => {
      const key = `${row.provider}:${row.model}`;
      const item = grouped.get(key) || { provider: row.provider, model: row.model, calls: 0, tokens: 0, cost: 0, latency: 0 };
      item.calls += 1;
      item.tokens += Number(row.total_tokens || 0);
      item.cost += Number(row.estimated_cost || 0);
      item.latency += Number(row.latency_ms || 0);
      grouped.set(key, item);
    });
    return Array.from(grouped.values()).sort((left, right) => right.tokens - left.tokens);
  }, [usage]);
  const maxTokens = Math.max(1, ...byModel.map((item) => item.tokens));

  if (loading) return <div className="grid gap-4"><Skeleton className="h-20" /><Skeleton className="h-96" /></div>;
  if (error) return <InlineError title={t("adminCenter.usage.loadFailed")} message={error} retryLabel={t("adminCenter.retry")} onRetry={() => void load()} />;

  return (
    <div data-page-enter className="grid gap-5">
      <header><div className="flex items-center gap-2"><Gauge className="h-5 w-5 text-primary" /><h2 className="text-xl font-semibold text-ink-strong">{t("adminCenter.usage.title")}</h2></div><p className="mt-1 max-w-3xl text-sm leading-5 text-ink-muted">{t("adminCenter.usage.description")}</p></header>
      <section className="grid gap-3 border-y border-[hsl(var(--border-subtle))] py-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label={t("adminCenter.usage.calls")} value={formatNumber(summary.calls)} />
        <Metric label={t("adminCenter.usage.tokens")} value={formatNumber(summary.tokens)} />
        <Metric label={t("adminCenter.usage.estimatedCost")} value={formatCurrency(summary.cost)} />
        <Metric label={t("adminCenter.usage.averageLatency")} value={`${summary.calls ? Math.round(summary.latency / summary.calls) : 0} ms`} />
      </section>
      <section>
        <h3 className="text-sm font-semibold text-ink-strong">{t("adminCenter.usage.byModel")}</h3>
        <div className="mt-3 divide-y divide-[hsl(var(--border-subtle))] rounded-lg border border-border bg-surface-1">
          {byModel.map((item) => (
            <article key={`${item.provider}:${item.model}`} className="grid gap-3 px-4 py-3 transition-colors duration-fast hover:bg-surface-2/60 md:grid-cols-[minmax(0,1fr)_160px_120px_120px] md:items-center">
              <div className="min-w-0"><div className="truncate text-sm font-medium text-ink-strong">{item.model}</div><div className="mt-0.5 text-xs text-ink-muted">{item.provider}</div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-accent transition-[width] duration-slow ease-standard" style={{ width: `${Math.max(2, item.tokens / maxTokens * 100)}%` }} /></div></div>
              <div className="text-xs text-ink-muted"><span className="block">{t("adminCenter.usage.tokens")}</span><span className="mt-1 block font-mono text-sm font-semibold tabular-nums text-ink-strong">{formatNumber(item.tokens)}</span></div>
              <div className="text-xs text-ink-muted"><span className="block">{t("adminCenter.usage.calls")}</span><span className="mt-1 block font-mono text-sm font-semibold tabular-nums text-ink-strong">{formatNumber(item.calls)}</span></div>
              <div className="text-xs text-ink-muted"><span className="block">{t("adminCenter.usage.estimatedCost")}</span><span className="mt-1 block font-mono text-sm font-semibold tabular-nums text-ink-strong">{formatCurrency(item.cost)}</span></div>
            </article>
          ))}
          {!byModel.length ? <div className="px-4 py-12 text-center text-sm text-ink-muted">{t("adminCenter.usage.empty")}</div> : null}
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="border-s-2 border-s-primary/35 bg-surface-2 px-3 py-2.5"><div className="text-xs text-ink-muted">{label}</div><div className="mt-2 truncate font-mono text-xl font-semibold tabular-nums text-ink-strong">{value}</div></div>; }
function formatNumber(value: number) { return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value); }
function formatCurrency(value: number) { return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(value); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error || "Unknown error"); }
