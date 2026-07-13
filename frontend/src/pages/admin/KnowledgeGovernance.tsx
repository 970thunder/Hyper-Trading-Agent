import { useEffect, useState } from "react";
import { Database, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, type CommercialKnowledgeBackendStatus, type CommercialKnowledgeBase } from "@/lib/api";
import { InlineError, Skeleton } from "@/components/ui/AsyncState";
import { StatusIndicator } from "@/components/ui/Status";

export function KnowledgeGovernance() {
  const { t } = useTranslation();
  const [bases, setBases] = useState<CommercialKnowledgeBase[]>([]);
  const [status, setStatus] = useState<CommercialKnowledgeBackendStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setError("");
    const [nextBases, nextStatus] = await Promise.all([api.listKnowledgeBases(), api.getCommercialKnowledgeBackendStatus()]);
    setBases(nextBases);
    setStatus(nextStatus);
  };

  useEffect(() => {
    let alive = true;
    load().catch((loadError) => { if (alive) setError(errorMessage(loadError)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  if (loading) return <div className="grid gap-4"><Skeleton className="h-24" /><Skeleton className="h-80" /></div>;
  if (error) return <InlineError title={t("adminCenter.knowledge.loadFailed")} message={error} retryLabel={t("adminCenter.retry")} onRetry={() => void load()} />;

  return (
    <div data-page-enter className="grid gap-5">
      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2"><Database className="h-5 w-5 text-primary" /><h2 className="text-xl font-semibold text-ink-strong">{t("adminCenter.knowledge.title")}</h2></div>
          <p className="mt-1 max-w-3xl text-sm leading-5 text-ink-muted">{t("adminCenter.knowledge.description")}</p>
        </div>
        <Link to="/knowledge" className="inline-flex h-9 items-center gap-2 rounded-md border border-primary bg-primary px-3 text-sm font-medium text-primary-foreground shadow-xs transition-[background-color,box-shadow,transform] duration-fast hover:bg-primary/90 hover:shadow-sm active:translate-y-px">
          {t("adminCenter.knowledge.openWorkspace")}<ExternalLink className="h-4 w-4" />
        </Link>
      </header>

      <section className="grid gap-3 border-y border-[hsl(var(--border-subtle))] py-4 sm:grid-cols-3">
        <Metric label={t("adminCenter.knowledge.baseCount")} value={String(bases.length)} />
        <Metric label={t("adminCenter.knowledge.vectorStorage")} value={status?.vector_storage?.active || status?.storage || "-"} />
        <Metric label={t("adminCenter.knowledge.embeddingProvider")} value={status ? `${status.primary.provider} / ${status.primary.model}` : "-"} />
      </section>

      <div className="overflow-hidden rounded-lg border border-border bg-surface-1">
        <div className="grid grid-cols-[minmax(0,1fr)_140px_140px] border-b border-[hsl(var(--border-subtle))] bg-surface-2 px-4 py-2.5 text-xs text-ink-muted max-sm:hidden">
          <span>{t("adminCenter.knowledge.base")}</span><span>{t("adminCenter.knowledge.retrieval")}</span><span>{t("adminCenter.knowledge.access")}</span>
        </div>
        <div className="divide-y divide-[hsl(var(--border-subtle))]">
          {bases.map((base) => (
            <Link key={base.id} to="/knowledge" className="grid gap-3 px-4 py-3 transition-colors duration-fast hover:bg-surface-2/60 sm:grid-cols-[minmax(0,1fr)_140px_140px] sm:items-center">
              <span className="min-w-0"><span className="block truncate text-sm font-medium text-ink-strong">{base.name}</span><span className="mt-0.5 block truncate text-xs text-ink-muted">{base.description || t("knowledgeWorkspace.noDescription")}</span></span>
              <StatusIndicator tone="primary" label={t(`knowledgeWorkspace.retrievalModes.${base.config?.retrieval_mode || "hybrid"}`)} />
              <span className="text-xs text-ink-muted">{t("adminCenter.knowledge.roleCount", { count: base.access?.read_roles?.length || 0 })}</span>
            </Link>
          ))}
          {!bases.length ? <div className="px-4 py-12 text-center text-sm text-ink-muted">{t("adminCenter.knowledge.empty")}</div> : null}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 border-s-2 border-s-primary/35 bg-surface-2 px-3 py-2.5"><div className="text-xs text-ink-muted">{label}</div><div className="mt-2 truncate font-mono text-sm font-semibold text-ink-strong" title={value}>{value}</div></div>;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}
