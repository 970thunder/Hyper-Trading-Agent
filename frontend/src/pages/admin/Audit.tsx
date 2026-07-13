import { useEffect, useMemo, useState } from "react";
import { ReceiptText, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api, type AuditLog } from "@/lib/api";
import { InlineError, Skeleton } from "@/components/ui/AsyncState";
import { Input } from "@/components/ui/Field";
import { StatusIndicator } from "@/components/ui/Status";

export function Audit() {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  const load = async () => {
    setError("");
    setLogs(await api.listAuditLogs(500));
  };

  useEffect(() => {
    let alive = true;
    load().catch((loadError) => { if (alive) setError(errorMessage(loadError)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return logs;
    return logs.filter((log) => [log.action, log.target_type, log.target_id, log.user_id, JSON.stringify(log.metadata)].join(" ").toLowerCase().includes(normalized));
  }, [logs, query]);

  if (loading) return <div className="grid gap-4"><Skeleton className="h-20" /><Skeleton className="h-96" /></div>;
  if (error) return <InlineError title={t("adminCenter.audit.loadFailed")} message={error} retryLabel={t("adminCenter.retry")} onRetry={() => void load()} />;

  return (
    <div data-page-enter className="grid gap-4">
      <header><div className="flex items-center gap-2"><ReceiptText className="h-5 w-5 text-primary" /><h2 className="text-xl font-semibold text-ink-strong">{t("adminCenter.audit.title")}</h2></div><p className="mt-1 max-w-3xl text-sm leading-5 text-ink-muted">{t("adminCenter.audit.description")}</p></header>
      <div className="flex flex-col gap-3 border-y border-[hsl(var(--border-subtle))] py-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block max-w-lg flex-1"><span className="sr-only">{t("adminCenter.audit.search")}</span><Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("adminCenter.audit.searchPlaceholder")} className="ps-9" /></label>
        <span className="text-xs tabular-nums text-ink-muted">{t("adminCenter.audit.eventCount", { count: filtered.length })}</span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface-1">
        <table className="w-full min-w-[880px] text-sm">
          <thead className="bg-surface-2 text-xs text-ink-muted"><tr><th className="px-4 py-2.5 text-start font-medium">{t("adminCenter.audit.event")}</th><th className="px-3 py-2.5 text-start font-medium">{t("adminCenter.audit.actor")}</th><th className="px-3 py-2.5 text-start font-medium">{t("adminCenter.audit.resource")}</th><th className="px-3 py-2.5 text-start font-medium">{t("adminCenter.audit.time")}</th></tr></thead>
          <tbody className="divide-y divide-[hsl(var(--border-subtle))]">
            {filtered.map((log) => <tr key={log.id} className="transition-colors duration-fast hover:bg-surface-2/60"><td className="px-4 py-3"><div className="font-mono text-xs font-medium text-ink-strong">{log.action}</div><div className="mt-1 max-w-[28rem] truncate text-xs text-ink-muted" title={JSON.stringify(log.metadata)}>{metadataSummary(log.metadata)}</div></td><td className="px-3 py-3 font-mono text-xs text-ink-muted">{log.user_id || "-"}</td><td className="px-3 py-3"><StatusIndicator tone="neutral" label={log.target_type || "-"} /><div className="mt-1 max-w-48 truncate font-mono text-[11px] text-ink-muted">{log.target_id || "-"}</div></td><td className="px-3 py-3 text-xs tabular-nums text-ink-muted">{formatDate(log.created_at)}</td></tr>)}
          </tbody>
        </table>
        {!filtered.length ? <div className="px-4 py-12 text-center text-sm text-ink-muted">{t("adminCenter.audit.empty")}</div> : null}
      </div>
    </div>
  );
}

function metadataSummary(metadata: Record<string, unknown>) { const entries = Object.entries(metadata || {}).slice(0, 4); return entries.length ? entries.map(([key, value]) => `${key}: ${String(value)}`).join(" · ") : "-"; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(date); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error || "Unknown error"); }
