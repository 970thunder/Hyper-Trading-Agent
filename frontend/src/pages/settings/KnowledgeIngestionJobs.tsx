import type { CommercialIngestionJob } from "@/lib/api";
import { useTranslation } from "react-i18next";

interface KnowledgeIngestionJobsProps {
  jobs: CommercialIngestionJob[];
  actionBusyId: string | null;
  onRetry: (jobId: string) => void;
  onCancel: (jobId: string) => void;
}

export function KnowledgeIngestionJobs({
  jobs,
  actionBusyId,
  onRetry,
  onCancel,
}: KnowledgeIngestionJobsProps) {
  const { t } = useTranslation();

  if (!jobs.length) return null;

  return (
    <div className="mt-5 overflow-hidden rounded-md border">
      <div className="border-b bg-muted/20 px-3 py-2 text-sm font-semibold">{t("settings.knowledge.ingestionJobs")}</div>
      <div className="divide-y">
        {jobs.slice(0, 6).map((job) => (
          <div key={job.id} className="grid gap-3 px-3 py-3 text-sm md:grid-cols-[minmax(0,1fr)_120px_100px_auto] md:items-center">
            <div className="min-w-0">
              <div className="truncate font-medium" title={job.document_id || job.id}>{job.document_id || job.id}</div>
              <div className="mt-1 truncate text-xs text-muted-foreground" title={job.error || job.updated_at}>{job.error || job.updated_at}</div>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${Math.max(0, Math.min(100, Number(job.progress || 0)))}%` }} />
            </div>
            <div className="text-xs text-muted-foreground">{job.status} · {Number(job.progress || 0)}%</div>
            <div className="flex justify-end gap-2">
              {job.status === "failed" ? (
                <button type="button" onClick={() => onRetry(job.id)} disabled={actionBusyId === `retry:${job.id}`} className="rounded-md border px-2 py-1 text-xs transition hover:bg-muted disabled:opacity-60">
                  {actionBusyId === `retry:${job.id}` ? t("settings.loading") : t("settings.knowledge.retry")}
                </button>
              ) : null}
              {job.status === "pending" || job.status === "running" ? (
                <button type="button" onClick={() => onCancel(job.id)} disabled={actionBusyId === `cancel:${job.id}`} className="rounded-md border px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted disabled:opacity-60">
                  {t("settings.knowledge.cancel")}
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
