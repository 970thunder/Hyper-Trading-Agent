import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, BriefcaseBusiness, KeyRound, Plus, RefreshCw, ShieldCheck, Wallet } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input } from "@/components/ui/Field";
import { Metric, Panel, SectionHeader } from "@/components/ui/Panel";
import { Select, type SelectOption } from "@/components/ui/Select";
import { StatusIndicator } from "@/components/ui/Status";
import { api, type CommercialPrincipal, type OrganizationPortfolioSnapshot, type PortfolioConnection } from "@/lib/api";
import { cn } from "@/lib/utils";

function money(value: number | null | undefined) { return value === null || value === undefined ? "-" : new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value); }
function percent(value: number | null | undefined) { return value === null || value === undefined ? "-" : `${(value * 100).toFixed(1)}%`; }

const emptyForm = { label: "", connector: "", profile_id: "", credential_reference: "" };

export function Portfolio() {
  const { t, i18n } = useTranslation();
  const [connections, setConnections] = useState<PortfolioConnection[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [snapshot, setSnapshot] = useState<OrganizationPortfolioSnapshot | null>(null);
  const [principal, setPrincipal] = useState<CommercialPrincipal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupError, setSetupError] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const canManage = principal?.role === "owner" || principal?.role === "admin";
  const options: SelectOption[] = connections.map((item) => ({ value: item.id, label: item.label, description: `${item.connector} | ${item.environment}` }));

  const loadConnections = useCallback(async () => {
    const [connectionResponse, me] = await Promise.all([api.listOrganizationPortfolioConnections(), api.getCommercialMe()]);
    setConnections(connectionResponse.connections);
    setPrincipal(me);
    setConnectionId((current) => current || connectionResponse.connections[0]?.id || "");
    return connectionResponse.connections;
  }, []);
  const loadSnapshot = useCallback(async (target = connectionId) => {
    if (!target) { setSnapshot(null); return; }
    setLoading(true); setError("");
    try { setSnapshot(await api.getOrganizationPortfolioSnapshot(target)); }
    catch { setSnapshot(null); setError(t("portfolio.loadError")); }
    finally { setLoading(false); }
  }, [connectionId, t]);
  useEffect(() => { void loadConnections().then((items) => { if (items[0]?.id) void loadSnapshot(items[0].id); }).catch(() => { setLoading(false); setError(t("portfolio.loadError")); }); }, [loadConnections, loadSnapshot, t]);
  useEffect(() => { if (connectionId) void loadSnapshot(connectionId); }, [connectionId, loadSnapshot]);

  const refresh = async () => {
    if (!connectionId) return;
    setLoading(true); setError("");
    try { setSnapshot(await api.refreshOrganizationPortfolioSnapshot(connectionId)); }
    catch { setError(t("portfolioSetup.refreshError")); }
    finally { setLoading(false); }
  };
  const createConnection = async () => {
    setCreating(true); setSetupError("");
    try {
      const created = await api.createOrganizationPortfolioConnection(form);
      setConnections((items) => [created, ...items]); setConnectionId(created.id); setForm(emptyForm); setSetupOpen(false);
    } catch { setSetupError(t("portfolioSetup.setupError")); }
    finally { setCreating(false); }
  };
  const summary = snapshot?.summary;
  const drawdown = snapshot?.drawdown;
  return <div data-page-enter className="min-h-full bg-canvas px-4 py-5 sm:px-6 sm:py-6 lg:px-8"><div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
    <header className="border-b border-[hsl(var(--border-subtle))] pb-5"><div className="mb-2 flex items-center gap-2 text-xs font-medium text-primary"><BriefcaseBusiness className="h-3.5 w-3.5" />{t("portfolio.navigation")}</div><h1 className="text-2xl font-semibold text-ink-strong">{t("portfolio.title")}</h1><p className="mt-1 max-w-3xl text-sm leading-6 text-ink-muted">{t("portfolio.subtitle")}</p></header>
    <Panel padding="none" className="overflow-visible shadow-xs"><div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-5"><div className="w-full sm:max-w-md"><Select value={connectionId} onValueChange={setConnectionId} options={options} label={t("portfolio.connection")} searchable searchPlaceholder={t("portfolio.searchConnections")} /></div><div className="flex gap-2">{canManage ? <Button variant="outline" onClick={() => setSetupOpen(true)} leftIcon={<Plus className="h-4 w-4" />}>{t("portfolioSetup.addConnection")}</Button> : null}<Button variant="outline" onClick={() => void refresh()} disabled={!connectionId || !canManage} loading={loading} loadingLabel={t("portfolio.loading")} leftIcon={<RefreshCw className="h-4 w-4" />}>{t("portfolio.refresh")}</Button></div></div></Panel>
    {error ? <div role="alert" className="rounded-md border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger">{error}</div> : null}
    {!loading && !connectionId ? <Panel padding="md"><div className="flex gap-3"><KeyRound className="mt-0.5 h-4 w-4 text-primary" /><div><div className="text-sm font-medium text-ink-strong">{t("portfolioSetup.noConnections")}</div><p className="mt-1 text-sm leading-5 text-ink-muted">{canManage ? t("portfolioSetup.noConnectionsAdmin") : t("portfolioSetup.noConnectionsMember")}</p></div></div></Panel> : null}
    {snapshot && summary ? <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label={t("portfolio.equity")} value={money(summary.equity)} /><Metric label={t("portfolio.cash")} value={money(summary.cash)} /><Metric label={t("portfolio.grossExposure")} value={money(summary.gross_exposure)} /><Metric label={t("portfolio.unrealizedPnl")} value={<span className={cn(summary.unrealized_pnl && summary.unrealized_pnl < 0 ? "text-danger" : "text-success")}>{money(summary.unrealized_pnl)}</span>} /></div><div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]"><Panel padding="none" className="overflow-hidden shadow-xs"><div className="px-4 py-4 sm:px-5"><SectionHeader title={t("portfolio.positions")} description={t("portfolio.positionsDescription", { count: summary.position_count })} /></div><div className="overflow-x-auto border-t border-[hsl(var(--border-subtle))]"><table className="w-full min-w-[680px] text-sm"><thead><tr className="bg-surface-2/55 text-xs text-ink-muted"><th className="px-5 py-2.5 text-left font-medium">{t("portfolio.asset")}</th><th className="px-4 py-2.5 text-right font-medium">{t("portfolio.quantity")}</th><th className="px-4 py-2.5 text-right font-medium">{t("portfolio.value")}</th><th className="px-4 py-2.5 text-right font-medium">{t("portfolio.weight")}</th><th className="px-5 py-2.5 text-right font-medium">{t("portfolio.unrealizedPnl")}</th></tr></thead><tbody className="divide-y divide-[hsl(var(--border-subtle))]">{snapshot.positions.map((item) => <tr key={item.symbol} className="hover:bg-surface-2/45"><td className="px-5 py-3"><div className="font-medium text-ink-strong">{item.symbol}</div><div className="text-xs text-ink-muted">{item.currency}</div></td><td className="px-4 py-3 text-right font-mono text-ink-muted">{item.quantity ?? "-"}</td><td className="px-4 py-3 text-right font-mono text-ink">{money(item.market_value)}</td><td className="px-4 py-3 text-right font-mono text-ink-muted">{percent(item.weight)}</td><td className={cn("px-5 py-3 text-right font-mono", item.unrealized_pnl && item.unrealized_pnl < 0 ? "text-danger" : "text-success")}>{money(item.unrealized_pnl)}</td></tr>)}</tbody></table></div></Panel><div className="grid content-start gap-3"><Panel padding="md"><div className="flex gap-3"><ShieldCheck className="mt-0.5 h-4 w-4 text-primary" /><div className="text-sm"><div className="font-medium text-ink-strong">{t("portfolio.riskSnapshot")}</div><div className="mt-2"><StatusIndicator label={t(`portfolio.risk.${summary.risk_level}`)} tone={summary.risk_level === "critical" || summary.risk_level === "high" ? "warning" : "success"} dot /></div><dl className="mt-3 grid grid-cols-2 gap-y-2 text-xs"><dt className="text-ink-muted">{t("portfolio.leverage")}</dt><dd className="text-right font-mono text-ink">{summary.leverage?.toFixed(2) ?? "-"}x</dd><dt className="text-ink-muted">{t("portfolio.topConcentration")}</dt><dd className="text-right font-mono text-ink">{percent(summary.top_concentration)}</dd><dt className="text-ink-muted">{t("portfolio.netExposure")}</dt><dd className="text-right font-mono text-ink">{money(summary.net_exposure)}</dd></dl></div></div></Panel><Panel padding="md"><div className="flex gap-3"><AlertTriangle className={cn("mt-0.5 h-4 w-4", drawdown?.available ? "text-warning" : "text-ink-muted")} /><div className="text-sm"><div className="font-medium text-ink-strong">{t("portfolio.drawdown")}</div>{drawdown?.available ? <><div className="mt-1 font-mono text-danger">{percent(drawdown.value)}</div><p className="mt-1 leading-5 text-ink-muted">{t("portfolioSetup.maxDrawdown", { value: percent(drawdown.max_drawdown) })}</p></> : <p className="mt-1 leading-5 text-ink-muted">{t("portfolio.drawdownUnavailable")}</p>}</div></div></Panel><Panel padding="md"><div className="flex gap-3"><Wallet className="mt-0.5 h-4 w-4 text-primary" /><div className="text-sm"><div className="font-medium text-ink-strong">{snapshot.connection.label}</div><p className="mt-1 text-ink-muted">{new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(snapshot.as_of))}</p></div></div></Panel></div></div></> : null}
  </div><Dialog open={setupOpen} onOpenChange={setSetupOpen} title={t("portfolioSetup.setupTitle")} description={t("portfolioSetup.setupDescription")} closeLabel={t("layout.cancel")} footer={<><Button variant="ghost" onClick={() => setSetupOpen(false)}>{t("layout.cancel")}</Button><Button onClick={() => void createConnection()} loading={creating} loadingLabel={t("portfolioSetup.creating")}>{t("portfolioSetup.addConnection")}</Button></>}><div className="grid gap-4"><Field label={t("portfolioSetup.connectionLabel")} required><Input value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} /></Field><Field label={t("portfolioSetup.connector")} required><Input value={form.connector} onChange={(event) => setForm({ ...form, connector: event.target.value })} /></Field><Field label={t("portfolioSetup.profileId")} hint={t("portfolioSetup.profileHint")}><Input value={form.profile_id} onChange={(event) => setForm({ ...form, profile_id: event.target.value })} /></Field><Field label={t("portfolioSetup.credentialReference")} hint={t("portfolioSetup.credentialHint")}><Input value={form.credential_reference} onChange={(event) => setForm({ ...form, credential_reference: event.target.value })} placeholder="vault://portfolio/team-a" /></Field>{setupError ? <p role="alert" className="text-sm text-danger">{setupError}</p> : null}</div></Dialog></div>;
}
