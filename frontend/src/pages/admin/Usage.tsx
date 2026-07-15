import { useEffect, useMemo, useState } from "react";
import { BellRing, Check, Gauge } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api, type CommercialPrincipal, type ModelUsage, type OrganizationUsagePolicy, type OrganizationUsageSummary, type UsageAlertEvent, type UsageTimeseriesPoint } from "@/lib/api";
import { InlineError, Skeleton } from "@/components/ui/AsyncState";
import { Button } from "@/components/ui/Button";
import { UsageTrendChart } from "@/components/charts/UsageTrendChart";

const EMPTY_POLICY: OrganizationUsagePolicy = {
  organization_id: "",
  monthly_token_soft_limit: 0,
  monthly_token_hard_limit: 0,
  monthly_cost_soft_limit: 0,
  monthly_cost_hard_limit: 0,
};

const EMPTY_MONTHLY_SUMMARY: OrganizationUsageSummary = {
  period_start: "",
  calls: 0,
  total_tokens: 0,
  estimated_cost: 0,
  average_latency_ms: 0,
  policy: EMPTY_POLICY,
  token_soft_limit_reached: false,
  token_hard_limit_reached: false,
  cost_soft_limit_reached: false,
  cost_hard_limit_reached: false,
};

export function Usage() {
  const { t } = useTranslation();
  const [usage, setUsage] = useState<ModelUsage[]>([]);
  const [monthlySummary, setMonthlySummary] = useState<OrganizationUsageSummary>(EMPTY_MONTHLY_SUMMARY);
  const [policy, setPolicy] = useState<OrganizationUsagePolicy>(EMPTY_POLICY);
  const [alerts, setAlerts] = useState<UsageAlertEvent[]>([]);
  const [timeseries, setTimeseries] = useState<UsageTimeseriesPoint[]>([]);
  const [principal, setPrincipal] = useState<CommercialPrincipal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [acknowledgingAlertId, setAcknowledgingAlertId] = useState("");

  const load = async () => {
    setError("");
    const [records, summary, nextPolicy, currentPrincipal, nextAlerts, trend] = await Promise.all([
      api.listModelUsage(1000),
      api.getUsageSummary(),
      api.getUsagePolicy(),
      api.getCommercialMe(),
      api.listUsageAlerts({ limit: 50 }),
      api.getUsageTimeseries(30),
    ]);
    setUsage(records);
    setMonthlySummary(summary);
    setPolicy(nextPolicy);
    setPrincipal(currentPrincipal);
    setAlerts(nextAlerts);
    setTimeseries(trend.series);
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
  const canEditBudget = principal?.role === "owner";
  const hardLimitReached = monthlySummary.token_hard_limit_reached || monthlySummary.cost_hard_limit_reached;
  const softLimitReached = monthlySummary.token_soft_limit_reached || monthlySummary.cost_soft_limit_reached;
  const alertLabels: Record<UsageAlertEvent["alert_type"], string> = {
    token_soft_limit: t("adminCenter.usage.alert.token_soft_limit"),
    token_hard_limit: t("adminCenter.usage.alert.token_hard_limit"),
    cost_soft_limit: t("adminCenter.usage.alert.cost_soft_limit"),
    cost_hard_limit: t("adminCenter.usage.alert.cost_hard_limit"),
  };

  const savePolicy = async () => {
    if (!canEditBudget || savingPolicy) return;
    setSavingPolicy(true);
    try {
      const nextPolicy = await api.updateUsagePolicy({
        monthly_token_soft_limit: Math.max(0, Number(policy.monthly_token_soft_limit || 0)),
        monthly_token_hard_limit: Math.max(0, Number(policy.monthly_token_hard_limit || 0)),
        monthly_cost_soft_limit: Math.max(0, Number(policy.monthly_cost_soft_limit || 0)),
        monthly_cost_hard_limit: Math.max(0, Number(policy.monthly_cost_hard_limit || 0)),
      });
      setPolicy(nextPolicy);
      setMonthlySummary((current) => ({ ...current, policy: nextPolicy }));
      toast.success(t("adminCenter.usage.budgetSaved"));
    } catch (saveError) {
      toast.error(errorMessage(saveError) || t("adminCenter.usage.budgetSaveFailed"));
    } finally {
      setSavingPolicy(false);
    }
  };

  const acknowledgeAlert = async (alertId: string) => {
    if (acknowledgingAlertId || !canEditBudget) return;
    setAcknowledgingAlertId(alertId);
    try {
      await api.acknowledgeUsageAlert(alertId);
      setAlerts((current) => current.filter((alert) => alert.id !== alertId));
      toast.success(t("adminCenter.usage.alertAcknowledged"));
    } catch (acknowledgeError) {
      toast.error(errorMessage(acknowledgeError) || t("adminCenter.usage.alertAcknowledgeFailed"));
    } finally {
      setAcknowledgingAlertId("");
    }
  };

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
      <section className="surface-panel p-4">
        <div className="border-b border-[hsl(var(--border-subtle))] pb-3">
          <h3 className="text-sm font-semibold text-ink-strong">{t("adminCenter.usage.title")}</h3>
          <p className="mt-1 text-sm text-ink-muted">{t("adminCenter.usage.description")}</p>
        </div>
        <div className="mt-3"><UsageTrendChart points={timeseries} tokenLabel={t("adminCenter.usage.tokens")} latencyLabel={t("adminCenter.usage.averageLatency")} /></div>
      </section>
      <section className="surface-panel p-4">
        <div className="flex flex-col gap-3 border-b border-[hsl(var(--border-subtle))] pb-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-ink-strong">{t("adminCenter.usage.budgetTitle")}</h3>
            <p className="mt-1 text-sm leading-5 text-ink-muted">{t("adminCenter.usage.budgetDescription")}</p>
          </div>
          <span className={[
            "inline-flex w-fit rounded-md border px-2.5 py-1 text-xs font-medium",
            hardLimitReached ? "border-danger/35 bg-danger/10 text-danger" : softLimitReached ? "border-warning/35 bg-warning/10 text-warning" : "border-success/35 bg-success/10 text-success",
          ].join(" ")}>{hardLimitReached ? t("adminCenter.usage.hardLimitReached") : softLimitReached ? t("adminCenter.usage.softLimitReached") : t("adminCenter.usage.withinBudget")}</span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <BudgetMetric label={t("adminCenter.usage.monthlyTokens")} value={formatNumber(monthlySummary.total_tokens)} limit={monthlySummary.policy.monthly_token_hard_limit} unlimitedLabel={t("adminCenter.usage.unlimited")} />
          <BudgetMetric label={t("adminCenter.usage.monthlyCost")} value={formatCurrency(monthlySummary.estimated_cost)} limit={monthlySummary.policy.monthly_cost_hard_limit} unlimitedLabel={t("adminCenter.usage.unlimited")} currency />
          <Metric label={t("adminCenter.usage.calls")} value={formatNumber(monthlySummary.calls)} />
          <Metric label={t("adminCenter.usage.averageLatency")} value={`${Math.round(monthlySummary.average_latency_ms)} ms`} />
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <BudgetInput label={t("adminCenter.usage.softTokenLimit")} value={policy.monthly_token_soft_limit} disabled={!canEditBudget} onChange={(value) => setPolicy((current) => ({ ...current, monthly_token_soft_limit: value }))} />
          <BudgetInput label={t("adminCenter.usage.hardTokenLimit")} value={policy.monthly_token_hard_limit} disabled={!canEditBudget} onChange={(value) => setPolicy((current) => ({ ...current, monthly_token_hard_limit: value }))} />
          <BudgetInput label={t("adminCenter.usage.softCostLimit")} value={policy.monthly_cost_soft_limit} disabled={!canEditBudget} step="0.01" onChange={(value) => setPolicy((current) => ({ ...current, monthly_cost_soft_limit: value }))} />
          <BudgetInput label={t("adminCenter.usage.hardCostLimit")} value={policy.monthly_cost_hard_limit} disabled={!canEditBudget} step="0.01" onChange={(value) => setPolicy((current) => ({ ...current, monthly_cost_hard_limit: value }))} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {canEditBudget ? <Button size="sm" variant="primary" loading={savingPolicy} onClick={() => void savePolicy()}>{t("adminCenter.usage.saveBudget")}</Button> : <p className="text-xs text-ink-muted">{t("adminCenter.usage.budgetOwnerOnly")}</p>}
          <p className="text-xs text-ink-muted">{t("adminCenter.usage.unlimitedHint")}</p>
        </div>
      </section>
      <section className="surface-panel p-4">
        <div className="flex items-start gap-2 border-b border-[hsl(var(--border-subtle))] pb-4"><BellRing className="mt-0.5 h-4 w-4 shrink-0 text-warning" /><div><h3 className="text-sm font-semibold text-ink-strong">{t("adminCenter.usage.alertsTitle")}</h3><p className="mt-1 text-sm leading-5 text-ink-muted">{t("adminCenter.usage.alertsDescription")}</p></div></div>
        <div className="mt-3 divide-y divide-[hsl(var(--border-subtle))]">
          {alerts.map((alert) => (
            <article key={alert.id} className="flex flex-col gap-3 py-3 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0"><div className="text-sm font-medium text-ink-strong">{alertLabels[alert.alert_type]}</div><div className="mt-1 text-xs text-ink-muted">{alertDetail(alert)} · {new Date(alert.created_at).toLocaleString()}</div></div>
              {canEditBudget ? <Button size="sm" variant="secondary" loading={acknowledgingAlertId === alert.id} onClick={() => void acknowledgeAlert(alert.id)}><Check className="h-3.5 w-3.5" />{t("adminCenter.usage.acknowledgeAlert")}</Button> : null}
            </article>
          ))}
          {!alerts.length ? <div className="py-8 text-center text-sm text-ink-muted">{t("adminCenter.usage.alertsEmpty")}</div> : null}
        </div>
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
function BudgetMetric({ label, value, limit, unlimitedLabel, currency = false }: { label: string; value: string; limit: number; unlimitedLabel: string; currency?: boolean }) { return <div className="border-s-2 border-s-accent/45 bg-surface-2 px-3 py-2.5"><div className="text-xs text-ink-muted">{label}</div><div className="mt-2 truncate font-mono text-xl font-semibold tabular-nums text-ink-strong">{value}</div><div className="mt-1 text-xs text-ink-muted">{limit > 0 ? `${currency ? "$" : ""}${formatNumber(limit)}` : unlimitedLabel}</div></div>; }
function BudgetInput({ label, value, disabled, onChange, step = "1" }: { label: string; value: number; disabled: boolean; onChange: (value: number) => void; step?: string }) { return <label className="grid gap-1.5"><span className="text-xs text-ink-muted">{label}</span><input type="number" min="0" step={step} value={value || 0} disabled={disabled} onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))} className="h-9 rounded-md border border-[hsl(var(--border-default))] bg-surface-1 px-2.5 text-sm text-ink-strong outline-none transition-[border-color,box-shadow] focus:border-primary/60 focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-55" /></label>; }
function formatNumber(value: number) { return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value); }
function formatCurrency(value: number) { return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(value); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error || "Unknown error"); }
function alertDetail(alert: UsageAlertEvent) { const current = Number(alert.metadata.current || 0); const limit = Number(alert.metadata.limit || 0); const value = alert.alert_type.startsWith("cost_") ? formatCurrency(current) : formatNumber(current); const cap = alert.alert_type.startsWith("cost_") ? formatCurrency(limit) : formatNumber(limit); return `${value} / ${cap}`; }
