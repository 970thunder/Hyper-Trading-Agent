import { useEffect, useMemo, useState } from "react";
import { Activity, Ban, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { api, type RuntimeJob } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { InlineError, Skeleton } from "@/components/ui/AsyncState";
import { Progress } from "@/components/ui/Progress";
import { StatusIndicator } from "@/components/ui/Status";
import { cn } from "@/lib/utils";

export function RuntimeGovernance() {
  const { t } = useTranslation();
  const [jobs, setJobs] = useState<RuntimeJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionId, setActionId] = useState<string | null>(null);

  const load = async () => {
    setError("");
    setJobs(await api.listRuntimeJobs());
  };

  useEffect(() => {
    let alive = true;
    load().catch((loadError) => { if (alive) setError(errorMessage(loadError)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const summary = useMemo(() => ({
    active: jobs.filter((job) => ["queued", "pending", "running"].includes(String(job.status))).length,
    failed: jobs.filter((job) => ["failed", "error"].includes(String(job.status))).length,
    completed: jobs.filter((job) => ["completed", "done"].includes(String(job.status))).length,
  }), [jobs]);

  const mutate = async (job: RuntimeJob, kind: "retry" | "cancel") => {
    setActionId(`${kind}:${job.job_id}`);
    try {
      if (kind === "retry") await api.retryRuntimeJob(job.job_id);
      else await api.cancelRuntimeJob(job.job_id);
      await load();
      toast.success(kind === "retry" ? t("adminCenter.runtime.retryStarted") : t("adminCenter.runtime.cancelled"));
    } catch (mutationError) {
      toast.error(errorMessage(mutationError));
    } finally {
      setActionId(null);
    }
  };

  if (loading) return <div className="grid gap-4"><Skeleton className="h-24" /><Skeleton className="h-96" /></div>;
  if (error) return <InlineError title={t("adminCenter.runtime.loadFailed")} message={error} retryLabel={t("adminCenter.retry")} onRetry={() => void load()} />;

  return (
    <div data-page-enter className="grid gap-5">
      <header><div className="flex items-center gap-2"><Activity className="h-5 w-5 text-primary" /><h2 className="text-xl font-semibold text-ink-strong">{t("adminCenter.runtime.title")}</h2></div><p className="mt-1 max-w-3xl text-sm leading-5 text-ink-muted">{t("adminCenter.runtime.description")}</p></header>
      <section className="grid gap-3 border-y border-[hsl(var(--border-subtle))] py-4 sm:grid-cols-3">
        <Metric label={t("adminCenter.runtime.active")} value={summary.active} tone="warning" />
        <Metric label={t("adminCenter.runtime.failed")} value={summary.failed} tone={summary.failed ? "danger" : "success"} />
        <Metric label={t("adminCenter.runtime.completed")} value={summary.completed} tone="success" />
      </section>
      <div className="divide-y divide-[hsl(var(--border-subtle))] rounded-lg border border-border bg-surface-1">
        {jobs.map((job) => {
          const status = normalizeStatus(String(job.status));
          return (
            <article key={job.job_id} className="grid gap-4 px-4 py-4 transition-colors duration-fast hover:bg-surface-2/60 lg:grid-cols-[minmax(0,1fr)_220px_auto] lg:items-center">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-sm font-medium text-ink-strong">{job.title || job.job_id}</h3><StatusIndicator tone={tone(status)} label={t(`knowledgeWorkspace.status.${status}`)} /></div><div className="mt-1 flex flex-wrap gap-3 text-xs text-ink-muted"><span className="font-mono">{job.kind}</span><span>{formatDate(job.updated_at)}</span></div>{job.error ? <p className="mt-2 text-xs text-danger">{job.error}</p> : null}</div>
              <Progress value={job.progress} label={t("adminCenter.runtime.progress")} showValue />
              <div className="flex justify-end gap-2">
                {status === "failed" ? <Button size="sm" variant="outline" loading={actionId === `retry:${job.job_id}`} leftIcon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => void mutate(job, "retry")}>{t("adminCenter.runtime.retry")}</Button> : null}
                {["pending", "running"].includes(status) ? <Button size="sm" variant="ghost" className="text-danger hover:bg-danger/10 hover:text-danger" loading={actionId === `cancel:${job.job_id}`} leftIcon={<Ban className="h-3.5 w-3.5" />} onClick={() => void mutate(job, "cancel")}>{t("adminCenter.runtime.cancel")}</Button> : null}
              </div>
            </article>
          );
        })}
        {!jobs.length ? <div className="px-4 py-12 text-center text-sm text-ink-muted">{t("adminCenter.runtime.empty")}</div> : null}
      </div>
    </div>
  );
}

type NormalizedStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
function normalizeStatus(status: string): NormalizedStatus {
  if (["completed", "done"].includes(status)) return "completed";
  if (["failed", "error"].includes(status)) return "failed";
  if (["cancelled", "canceled"].includes(status)) return "cancelled";
  if (status === "running") return "running";
  return "pending";
}
function tone(status: NormalizedStatus): "success" | "warning" | "danger" | "neutral" { return status === "completed" ? "success" : status === "failed" ? "danger" : status === "cancelled" ? "neutral" : "warning"; }
function Metric({ label, value, tone: valueTone }: { label: string; value: number; tone: "success" | "warning" | "danger" }) { return <div className="border-s-2 border-s-primary/35 bg-surface-2 px-3 py-2.5"><div className="text-xs text-ink-muted">{label}</div><div className={cn("mt-2 text-2xl font-semibold tabular-nums", valueTone === "success" && "text-success", valueTone === "warning" && "text-warning", valueTone === "danger" && "text-danger")}>{value}</div></div>; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error || "Unknown error"); }
