import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, BriefcaseBusiness, RefreshCw, ShieldCheck, Wallet } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Metric, Panel, SectionHeader } from "@/components/ui/Panel";
import { Select, type SelectOption } from "@/components/ui/Select";
import { StatusIndicator } from "@/components/ui/Status";
import { api, type PortfolioSnapshot } from "@/lib/api";
import { cn } from "@/lib/utils";

function money(value: number | null | undefined) { return value === null || value === undefined ? "-" : new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value); }
function percent(value: number | null | undefined) { return value === null || value === undefined ? "-" : `${(value * 100).toFixed(1)}%`; }

export function Portfolio() {
  const { t, i18n } = useTranslation();
  const [options, setOptions] = useState<SelectOption[]>([]);
  const [profile, setProfile] = useState("");
  const [snapshot, setSnapshot] = useState<PortfolioSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async (profileId = profile) => {
    setLoading(true); setError("");
    try { setSnapshot(await api.getPortfolioSnapshot(profileId || undefined)); }
    catch { setError(t("portfolio.loadError")); }
    finally { setLoading(false); }
  }, [profile, t]);
  useEffect(() => { void api.listPortfolioProfiles().then((data) => { const next = data.profiles.map((item) => ({ value: item.id, label: item.label, description: `${item.connector} | ${item.environment}` })); setOptions(next); setProfile((current) => current || next[0]?.value || ""); }).catch(() => setError(t("portfolio.loadError"))); }, [t]);
  useEffect(() => { if (profile) void load(profile); }, [profile, load]);
  const summary = snapshot?.summary;
  return <div data-page-enter className="min-h-full bg-canvas px-4 py-5 sm:px-6 sm:py-6 lg:px-8"><div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
    <header className="border-b border-[hsl(var(--border-subtle))] pb-5"><div className="mb-2 flex items-center gap-2 text-xs font-medium text-primary"><BriefcaseBusiness className="h-3.5 w-3.5" />{t("portfolio.navigation")}</div><h1 className="text-2xl font-semibold text-ink-strong">{t("portfolio.title")}</h1><p className="mt-1 max-w-3xl text-sm leading-6 text-ink-muted">{t("portfolio.subtitle")}</p></header>
    <Panel padding="none" className="overflow-visible shadow-xs"><div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-5"><div className="w-full sm:max-w-md"><Select value={profile} onValueChange={setProfile} options={options} label={t("portfolio.connection")} searchable searchPlaceholder={t("portfolio.searchConnections")} /></div><Button variant="outline" onClick={() => void load()} loading={loading} loadingLabel={t("portfolio.loading")} leftIcon={<RefreshCw className="h-4 w-4" />}>{t("portfolio.refresh")}</Button></div></Panel>
    {error ? <div role="alert" className="rounded-md border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger">{error}</div> : null}
    {snapshot && summary ? <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label={t("portfolio.equity")} value={money(summary.equity)} /><Metric label={t("portfolio.cash")} value={money(summary.cash)} /><Metric label={t("portfolio.grossExposure")} value={money(summary.gross_exposure)} /><Metric label={t("portfolio.unrealizedPnl")} value={<span className={cn(summary.unrealized_pnl && summary.unrealized_pnl < 0 ? "text-danger" : "text-success")}>{money(summary.unrealized_pnl)}</span>} /></div><div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]"><Panel padding="none" className="overflow-hidden shadow-xs"><div className="px-4 py-4 sm:px-5"><SectionHeader title={t("portfolio.positions")} description={t("portfolio.positionsDescription", { count: summary.position_count })} /></div><div className="overflow-x-auto border-t border-[hsl(var(--border-subtle))]"><table className="w-full min-w-[680px] text-sm"><thead><tr className="bg-surface-2/55 text-xs text-ink-muted"><th className="px-5 py-2.5 text-left font-medium">{t("portfolio.asset")}</th><th className="px-4 py-2.5 text-right font-medium">{t("portfolio.quantity")}</th><th className="px-4 py-2.5 text-right font-medium">{t("portfolio.value")}</th><th className="px-4 py-2.5 text-right font-medium">{t("portfolio.weight")}</th><th className="px-5 py-2.5 text-right font-medium">{t("portfolio.unrealizedPnl")}</th></tr></thead><tbody className="divide-y divide-[hsl(var(--border-subtle))]">{snapshot.positions.map((item) => <tr key={item.symbol} className="hover:bg-surface-2/45"><td className="px-5 py-3"><div className="font-medium text-ink-strong">{item.symbol}</div><div className="text-xs text-ink-muted">{item.currency}</div></td><td className="px-4 py-3 text-right font-mono text-ink-muted">{item.quantity ?? "-"}</td><td className="px-4 py-3 text-right font-mono text-ink">{money(item.market_value)}</td><td className="px-4 py-3 text-right font-mono text-ink-muted">{percent(item.weight)}</td><td className={cn("px-5 py-3 text-right font-mono", item.unrealized_pnl && item.unrealized_pnl < 0 ? "text-danger" : "text-success")}>{money(item.unrealized_pnl)}</td></tr>)}</tbody></table></div></Panel><div className="grid content-start gap-3"><Panel padding="md"><div className="flex gap-3"><ShieldCheck className="mt-0.5 h-4 w-4 text-primary" /><div className="text-sm"><div className="font-medium text-ink-strong">{t("portfolio.riskSnapshot")}</div><div className="mt-2"><StatusIndicator label={t(`portfolio.risk.${summary.risk_level}`)} tone={summary.risk_level === "critical" || summary.risk_level === "high" ? "warning" : "success"} dot /></div><dl className="mt-3 grid grid-cols-2 gap-y-2 text-xs"><dt className="text-ink-muted">{t("portfolio.leverage")}</dt><dd className="text-right font-mono text-ink">{summary.leverage?.toFixed(2) ?? "-"}x</dd><dt className="text-ink-muted">{t("portfolio.topConcentration")}</dt><dd className="text-right font-mono text-ink">{percent(summary.top_concentration)}</dd><dt className="text-ink-muted">{t("portfolio.netExposure")}</dt><dd className="text-right font-mono text-ink">{money(summary.net_exposure)}</dd></dl></div></div></Panel><Panel padding="md"><div className="flex gap-3"><AlertTriangle className="mt-0.5 h-4 w-4 text-warning" /><div className="text-sm"><div className="font-medium text-ink-strong">{t("portfolio.drawdown")}</div><p className="mt-1 leading-5 text-ink-muted">{t("portfolio.drawdownUnavailable")}</p></div></div></Panel><Panel padding="md"><div className="flex gap-3"><Wallet className="mt-0.5 h-4 w-4 text-primary" /><div className="text-sm"><div className="font-medium text-ink-strong">{snapshot.profile.label}</div><p className="mt-1 text-ink-muted">{new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(snapshot.as_of))}</p></div></div></Panel></div></div></> : null}
  </div></div>;
}
