import { AlertTriangle, Clock3, RefreshCw, Square } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { RuntimeJob } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { Progress } from "@/components/ui/Progress";
import { StatusIndicator, type StatusTone } from "@/components/ui/Status";

interface RuntimeJobDrawerProps {
  job: RuntimeJob | null;
  sourceLabel: string;
  open: boolean;
  actionId: string | null;
  onOpenChange: (open: boolean) => void;
  onRetry: (job: RuntimeJob) => Promise<void>;
  onRequestCancel: (job: RuntimeJob) => void;
}

export function RuntimeJobDrawer({
  job,
  sourceLabel,
  open,
  actionId,
  onOpenChange,
  onRetry,
  onRequestCancel,
}: RuntimeJobDrawerProps) {
  const { t } = useTranslation();
  if (!job) return null;

  const active = isActiveJob(job.status);
  const failed = isFailedJob(job.status);
  const progress = Math.max(0, Math.min(100, Number(job.progress || 0)));

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={job.title || job.job_id}
      description={t("runtime.jobDetailsDescription", { source: sourceLabel })}
      closeLabel={t("runtime.closeJobDetails")}
      className="sm:w-[26rem]"
      footer={(
        <div className="flex w-full items-center justify-between gap-3">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("runtime.close")}
          </Button>
          <div className="flex items-center gap-2">
            {failed ? (
              <Button
                variant="outline"
                loading={actionId === `retry:${job.job_id}`}
                loadingLabel={t("runtime.working")}
                leftIcon={<RefreshCw className="h-4 w-4" />}
                onClick={() => void onRetry(job)}
              >
                {t("runtime.retryJob")}
              </Button>
            ) : null}
            {active ? (
              <Button
                variant="destructive"
                leftIcon={<Square className="h-3.5 w-3.5" />}
                onClick={() => onRequestCancel(job)}
              >
                {t("runtime.cancelJob")}
              </Button>
            ) : null}
          </div>
        </div>
      )}
    >
      <div className="grid gap-6 p-4 sm:p-5">
        <section className="grid gap-3 border-b border-[hsl(var(--border-subtle))] pb-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <StatusIndicator label={job.status} tone={jobStatusTone(job.status)} dot />
            <span className="font-mono text-xs text-ink-muted">{job.job_id}</span>
          </div>
          <Progress value={progress} label={t("runtime.progress")} showValue />
        </section>

        <section className="grid grid-cols-2 gap-x-5 gap-y-4" aria-label={t("runtime.jobMetadata")}>
          <JobDatum label={t("runtime.source")} value={sourceLabel} />
          <JobDatum label={t("runtime.jobKind")} value={job.kind || "-"} mono />
          <JobDatum label={t("runtime.created")} value={formatJobDate(job.created_at)} />
          <JobDatum label={t("runtime.updated")} value={formatJobDate(job.updated_at)} />
          <JobDatum
            label={t("runtime.elapsed")}
            value={formatElapsed(job.created_at, job.updated_at, t("runtime.durationUnavailable"))}
            icon={<Clock3 className="h-3.5 w-3.5" />}
          />
          <JobDatum label={t("runtime.status")} value={job.status} />
        </section>

        <section className="border-t border-[hsl(var(--border-subtle))] pt-5">
          <h3 className="text-xs font-semibold text-ink-strong">{t("runtime.errorDetails")}</h3>
          {job.error ? (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-danger/25 bg-danger/8 p-3 text-sm leading-5 text-danger">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p className="min-w-0 break-words">{job.error}</p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">{t("runtime.noErrorDetails")}</p>
          )}
        </section>
      </div>
    </Drawer>
  );
}

function JobDatum({
  label,
  value,
  mono = false,
  icon,
}: {
  label: string;
  value: string;
  mono?: boolean;
  icon?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs leading-4 text-ink-muted">{label}</div>
      <div className={`mt-1 flex min-w-0 items-center gap-1.5 text-sm text-ink-strong ${mono ? "font-mono" : ""}`}>
        {icon ? <span className="shrink-0 text-ink-muted" aria-hidden="true">{icon}</span> : null}
        <span className="min-w-0 break-words">{value || "-"}</span>
      </div>
    </div>
  );
}

export function isActiveJob(status: string): boolean {
  return ["queued", "pending", "running"].includes(status);
}

export function isFailedJob(status: string): boolean {
  return ["failed", "error"].includes(status);
}

export function isCompletedJob(status: string): boolean {
  return ["completed", "done"].includes(status);
}

export function jobStatusTone(status: string): StatusTone {
  if (isCompletedJob(status)) return "success";
  if (isFailedJob(status)) return "danger";
  if (isActiveJob(status)) return "warning";
  return "neutral";
}

export function formatJobDate(value: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatElapsed(startValue: string, endValue: string, fallback: string): string {
  const start = new Date(startValue).getTime();
  const end = new Date(endValue).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return fallback;
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}
