import { Ban, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CommercialIngestionJob, CommercialKnowledgeDocument } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Progress } from "@/components/ui/Progress";
import { StatusIndicator, type StatusTone } from "@/components/ui/Status";

interface IngestionJobsProps {
  jobs: CommercialIngestionJob[];
  documents: CommercialKnowledgeDocument[];
  canWrite: boolean;
  actionId: string | null;
  onRetry: (job: CommercialIngestionJob) => void;
  onCancel: (job: CommercialIngestionJob) => void;
}

export function IngestionJobs({ jobs, documents, canWrite, actionId, onRetry, onCancel }: IngestionJobsProps) {
  const { t } = useTranslation();
  const titleById = new Map(documents.map((document) => [document.id, document.title]));

  if (!jobs.length) {
    return <div className="px-5 py-14 text-center text-sm text-ink-muted">{t("knowledgeWorkspace.jobsEmpty")}</div>;
  }

  return (
    <div className="divide-y divide-[hsl(var(--border-subtle))]">
      {jobs.map((job) => {
        const normalized = normalizeStatus(job.status);
        const stage = String(job.metadata?.stage || normalized);
        const title = titleById.get(String(job.document_id || "")) || String(job.metadata?.title || job.metadata?.url || job.id);
        const canCancel = canWrite && ["pending", "running"].includes(normalized);
        const canRetry = canWrite && normalized === "failed";
        return (
          <article key={job.id} className="grid gap-4 px-4 py-4 transition-colors duration-fast hover:bg-surface-2/60 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-sm font-medium text-ink-strong">{title}</h3>
                <StatusIndicator tone={statusTone(normalized)} label={t(`knowledgeWorkspace.status.${normalized}`)} dot />
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted">
                <span>{t("knowledgeWorkspace.stage")}: {t(`knowledgeWorkspace.stageValues.${normalizeStage(stage)}`)}</span>
                <span className="font-mono">{job.id}</span>
                <span>{formatDate(job.updated_at)}</span>
              </div>
              {job.error ? <p className="mt-2 text-xs leading-5 text-danger">{job.error}</p> : null}
            </div>
            <Progress value={job.progress} label={t("knowledgeWorkspace.jobProgress")} showValue />
            <div className="flex justify-end gap-1.5">
              {canRetry ? (
                <Button
                  variant="outline"
                  size="sm"
                  leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
                  loading={actionId === `retry:${job.id}`}
                  onClick={() => onRetry(job)}
                >
                  {t("knowledgeWorkspace.retry")}
                </Button>
              ) : null}
              {canCancel ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-danger hover:bg-danger/10 hover:text-danger"
                  leftIcon={<Ban className="h-3.5 w-3.5" />}
                  loading={actionId === `cancel:${job.id}`}
                  onClick={() => onCancel(job)}
                >
                  {t("knowledgeWorkspace.cancel")}
                </Button>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function normalizeStatus(status: string): "pending" | "running" | "completed" | "failed" | "cancelled" {
  const value = status.toLowerCase();
  if (["ready", "completed", "done"].includes(value)) return "completed";
  if (["running", "indexing"].includes(value)) return "running";
  if (["failed", "error"].includes(value)) return "failed";
  if (["cancelled", "canceled"].includes(value)) return "cancelled";
  return "pending";
}

function normalizeStage(stage: string): "queued" | "parsing" | "chunking" | "embedding" | "indexing" | "completed" | "failed" {
  const value = stage.toLowerCase();
  if (["parsing", "chunking", "embedding", "indexing", "completed", "failed"].includes(value)) {
    return value as "parsing" | "chunking" | "embedding" | "indexing" | "completed" | "failed";
  }
  if (value === "running") return "indexing";
  if (value === "cancelled") return "failed";
  return "queued";
}

function statusTone(status: ReturnType<typeof normalizeStatus>): StatusTone {
  if (status === "completed") return "success";
  if (status === "failed") return "danger";
  if (status === "running" || status === "pending") return "warning";
  return "neutral";
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "-";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
