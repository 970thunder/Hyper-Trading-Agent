import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Eye, Layers3, RefreshCw, Search, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { RuntimeJob } from "@/lib/api";
import { Button, IconButton } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Metric, Panel, SectionHeader } from "@/components/ui/Panel";
import { Progress } from "@/components/ui/Progress";
import { Select, type SelectOption } from "@/components/ui/Select";
import { StatusIndicator } from "@/components/ui/Status";
import { cn } from "@/lib/utils";
import {
  RuntimeJobDrawer,
  formatJobDate,
  isActiveJob,
  isCompletedJob,
  isFailedJob,
  jobStatusTone,
} from "./RuntimeJobDrawer";

export interface RuntimeJobsWorkspaceProps {
  jobs: RuntimeJob[];
  loading: boolean;
  error: string | null;
  actionError: string | null;
  actionId: string | null;
  onRetry: (job: RuntimeJob) => Promise<void>;
  onCancel: (job: RuntimeJob) => Promise<void>;
  onDismissActionError: () => void;
}

type RuntimeJobSource = "agent" | "rag" | "web" | "backtest" | "other";
type RuntimeJobStatusFilter = "all" | "active" | "failed" | "completed" | "cancelled";

const SOURCE_FILTER_VALUES = ["all", "agent", "rag", "web", "backtest", "other"] as const;
const SOURCE_LABEL_KEYS = {
  all: "runtime.jobSource.all",
  agent: "runtime.jobSource.agent",
  rag: "runtime.jobSource.rag",
  web: "runtime.jobSource.web",
  backtest: "runtime.jobSource.backtest",
  other: "runtime.jobSource.other",
} as const satisfies Record<RuntimeJobSource | "all", string>;

const STATUS_FILTER_VALUES = ["all", "active", "failed", "completed", "cancelled"] as const;
const STATUS_LABEL_KEYS = {
  all: "runtime.jobStatusFilter.all",
  active: "runtime.jobStatusFilter.active",
  failed: "runtime.jobStatusFilter.failed",
  completed: "runtime.jobStatusFilter.completed",
  cancelled: "runtime.jobStatusFilter.cancelled",
} as const satisfies Record<RuntimeJobStatusFilter, string>;

interface ClassifiedRuntimeJob {
  raw: RuntimeJob;
  source: RuntimeJobSource;
}

export function RuntimeJobsWorkspace({
  jobs,
  loading,
  error,
  actionError,
  actionId,
  onRetry,
  onCancel,
  onDismissActionError,
}: RuntimeJobsWorkspaceProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<RuntimeJobSource | "all">("all");
  const [statusFilter, setStatusFilter] = useState<RuntimeJobStatusFilter>("all");
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [cancelCandidate, setCancelCandidate] = useState<RuntimeJob | null>(null);

  const classifiedJobs = useMemo(() => jobs.map(classifyRuntimeJob), [jobs]);
  const selectedJob = useMemo(
    () => jobs.find((job) => job.job_id === selectedJobId) || null,
    [jobs, selectedJobId],
  );
  const summary = useMemo(() => summarizeJobs(jobs), [jobs]);
  const visibleJobs = useMemo(
    () => classifiedJobs.filter((job) => matchesFilters(job, sourceFilter, statusFilter, query)),
    [classifiedJobs, sourceFilter, statusFilter, query],
  );

  useEffect(() => {
    if (selectedJobId && !jobs.some((job) => job.job_id === selectedJobId)) setSelectedJobId(null);
  }, [jobs, selectedJobId]);

  const sourceOptions: SelectOption[] = SOURCE_FILTER_VALUES.map((value) => ({
    value,
    label: t(SOURCE_LABEL_KEYS[value]),
  }));
  const statusOptions: SelectOption[] = STATUS_FILTER_VALUES.map((value) => ({
    value,
    label: t(STATUS_LABEL_KEYS[value]),
  }));
  const selectedSource = selectedJob ? classifyRuntimeJob(selectedJob).source : "other";

  return (
    <Panel padding="none" className="overflow-hidden shadow-xs" aria-labelledby="runtime-jobs-title">
      <div className="px-4 py-4 sm:px-5">
        <SectionHeader
          title={<span id="runtime-jobs-title">{t("runtime.jobsTitle")}</span>}
          description={t("runtime.jobsDescription")}
          actions={loading && jobs.length > 0 ? (
            <StatusIndicator label={t("runtime.refreshingJobs")} tone="info" dot />
          ) : undefined}
        />
      </div>

      <div className="grid grid-cols-2 border-y border-[hsl(var(--border-subtle))] bg-surface-2/55 sm:grid-cols-4 sm:divide-x sm:divide-[hsl(var(--border-subtle))]">
        <QueueMetric label={t("runtime.jobsTotal")} value={t("runtime.jobsCount", { count: summary.total })} icon={Layers3} />
        <QueueMetric label={t("runtime.jobsRunning")} value={t("runtime.jobsRunningCount", { count: summary.active })} icon={RefreshCw} tone={summary.active ? "info" : "neutral"} />
        <QueueMetric label={t("runtime.jobsFailed")} value={t("runtime.jobsFailedCount", { count: summary.failed })} icon={AlertTriangle} tone={summary.failed ? "danger" : "neutral"} />
        <QueueMetric label={t("runtime.jobsCompleted")} value={t("runtime.jobsCompletedCount", { count: summary.completed })} icon={CheckCircle2} tone={summary.completed ? "success" : "neutral"} />
      </div>

      <div className="flex flex-col gap-3 border-b border-[hsl(var(--border-subtle))] px-4 py-3 sm:px-5 lg:flex-row lg:items-end lg:justify-between">
        <label className="min-w-0 flex-1 lg:max-w-md">
          <span className="mb-1.5 block text-xs font-medium text-ink-muted">{t("runtime.searchJobs")}</span>
          <span className="flex h-9 items-center gap-2 rounded-md border border-border bg-surface-1 px-3 shadow-xs transition-[border-color,box-shadow,background-color] duration-fast focus-within:border-primary/45 focus-within:ring-2 focus-within:ring-primary/20">
            <Search className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label={t("runtime.searchJobs")}
              placeholder={t("runtime.searchJobsPlaceholder")}
              className="h-full min-w-0 flex-1 bg-transparent text-sm text-ink-strong outline-none placeholder:text-ink-disabled"
            />
          </span>
        </label>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-end">
          <FilterField label={t("runtime.sourceFilter")}>
            <Select
              value={sourceFilter}
              onValueChange={(value) => setSourceFilter(value as RuntimeJobSource | "all")}
              options={sourceOptions}
              label={t("runtime.sourceFilter")}
              className="w-full sm:w-44"
            />
          </FilterField>
          <FilterField label={t("runtime.statusFilter")}>
            <Select
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value as RuntimeJobStatusFilter)}
              options={statusOptions}
              label={t("runtime.statusFilter")}
              className="w-full sm:w-40"
            />
          </FilterField>
        </div>
      </div>

      {actionError ? (
        <div role="alert" className="mx-4 mt-4 flex items-start justify-between gap-3 rounded-md border border-danger/25 bg-danger/8 px-3 py-2.5 text-sm text-danger sm:mx-5">
          <div className="flex min-w-0 items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <div className="font-medium">{t("runtime.actionFailedTitle")}</div>
              <p className="mt-0.5 break-words text-xs leading-5">{actionError}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onDismissActionError}>{t("runtime.dismiss")}</Button>
        </div>
      ) : null}

      {error ? (
        <div role="status" className="mx-4 mt-4 flex items-start gap-2 rounded-md border border-warning/25 bg-warning/8 px-3 py-2.5 text-sm text-warning sm:mx-5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <div className="font-medium">{t("runtime.jobsUnavailable")}</div>
            <p className="mt-0.5 text-xs leading-5">{error}</p>
          </div>
        </div>
      ) : null}

      <div className="px-4 py-3 text-xs text-ink-muted sm:px-5">
        {t("runtime.durableCount", { shown: visibleJobs.length, total: classifiedJobs.length })}
      </div>

      <div className="overflow-x-auto border-t border-[hsl(var(--border-subtle))]">
        <table className="w-full min-w-[760px] table-fixed text-sm">
          <thead className="bg-surface-2 text-xs text-ink-muted">
            <tr>
              <th className="w-[32%] px-4 py-2.5 text-left font-medium">{t("runtime.job")}</th>
              <th className="w-[13%] px-3 py-2.5 text-left font-medium">{t("runtime.source")}</th>
              <th className="w-[13%] px-3 py-2.5 text-left font-medium">{t("runtime.status")}</th>
              <th className="w-[18%] px-3 py-2.5 text-left font-medium">{t("runtime.progress")}</th>
              <th className="w-[14%] px-3 py-2.5 text-left font-medium">{t("runtime.updated")}</th>
              <th className="w-[10%] px-3 py-2.5 text-right font-medium">{t("runtime.actions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[hsl(var(--border-subtle))]">
            {loading && !jobs.length ? <RuntimeJobSkeletonRows /> : null}
            {!loading && !jobs.length ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center">
                  <Layers3 className="mx-auto h-6 w-6 text-ink-disabled" aria-hidden="true" />
                  <div className="mt-2 text-sm font-medium text-ink-strong">{t("runtime.noJobs")}</div>
                  <p className="mt-1 text-xs text-ink-muted">{t("runtime.noJobsDescription")}</p>
                </td>
              </tr>
            ) : null}
            {jobs.length > 0 && !visibleJobs.length ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-ink-muted">{t("runtime.noDurableMatches")}</td>
              </tr>
            ) : null}
            {visibleJobs.map((classifiedJob) => (
              <RuntimeJobRow
                key={classifiedJob.raw.job_id}
                job={classifiedJob.raw}
                sourceLabel={t(`runtime.jobSource.${classifiedJob.source}`)}
                actionId={actionId}
                onOpen={() => setSelectedJobId(classifiedJob.raw.job_id)}
                onRetry={onRetry}
                onRequestCancel={setCancelCandidate}
              />
            ))}
          </tbody>
        </table>
      </div>

      <RuntimeJobDrawer
        job={selectedJob}
        sourceLabel={t(`runtime.jobSource.${selectedSource}`)}
        open={Boolean(selectedJob)}
        actionId={actionId}
        onOpenChange={(open) => { if (!open) setSelectedJobId(null); }}
        onRetry={onRetry}
        onRequestCancel={setCancelCandidate}
      />

      <Dialog
        open={Boolean(cancelCandidate)}
        onOpenChange={(open) => { if (!open) setCancelCandidate(null); }}
        title={t("runtime.cancelConfirmTitle")}
        description={cancelCandidate ? t("runtime.cancelConfirmDescription", { title: cancelCandidate.title || cancelCandidate.job_id }) : undefined}
        closeLabel={t("runtime.close")}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setCancelCandidate(null)}>{t("runtime.keepJob")}</Button>
            <Button
              variant="destructive"
              loading={Boolean(cancelCandidate && actionId === `cancel:${cancelCandidate.job_id}`)}
              loadingLabel={t("runtime.working")}
              leftIcon={<Square className="h-3.5 w-3.5" />}
              onClick={async () => {
                if (!cancelCandidate) return;
                await onCancel(cancelCandidate);
                setCancelCandidate(null);
              }}
            >
              {t("runtime.confirmCancellation")}
            </Button>
          </>
        )}
      >
        <p className="text-sm leading-6 text-ink">{t("runtime.cancelConfirmBody")}</p>
        {cancelCandidate ? (
          <div className="mt-4 rounded-md border border-[hsl(var(--border-subtle))] bg-surface-2 px-3 py-2.5">
            <div className="text-sm font-medium text-ink-strong">{cancelCandidate.title || cancelCandidate.job_id}</div>
            <div className="mt-1 font-mono text-xs text-ink-muted">{cancelCandidate.job_id}</div>
          </div>
        ) : null}
      </Dialog>
    </Panel>
  );
}

function QueueMetric({
  label,
  value,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  icon: typeof Layers3;
  tone?: "neutral" | "info" | "success" | "danger";
}) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3 px-4 py-3.5 sm:px-5">
      <Metric label={label} value={value} />
      <span className={cn(
        "mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-surface-1 shadow-xs",
        tone === "neutral" && "border-border text-ink-muted",
        tone === "info" && "border-info/25 text-info",
        tone === "success" && "border-success/25 text-success",
        tone === "danger" && "border-danger/25 text-danger",
      )}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 text-xs font-medium text-ink-muted">{label}</div>
      {children}
    </div>
  );
}

function RuntimeJobRow({
  job,
  sourceLabel,
  actionId,
  onOpen,
  onRetry,
  onRequestCancel,
}: {
  job: RuntimeJob;
  sourceLabel: string;
  actionId: string | null;
  onOpen: () => void;
  onRetry: (job: RuntimeJob) => Promise<void>;
  onRequestCancel: (job: RuntimeJob) => void;
}) {
  const { t } = useTranslation();
  const active = isActiveJob(job.status);
  const failed = isFailedJob(job.status);

  return (
    <tr className="group bg-surface-1 transition-colors duration-instant hover:bg-surface-2/70">
      <td className="px-4 py-3 align-top">
        <button type="button" onClick={onOpen} className="block max-w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">
          <span className="block truncate font-medium text-ink-strong group-hover:text-primary">{job.title || job.job_id}</span>
          <span className="mt-0.5 block truncate font-mono text-xs text-ink-muted">{job.kind} / {job.job_id}</span>
        </button>
        {job.error ? <div className="mt-1.5 line-clamp-2 text-xs leading-4 text-danger">{job.error}</div> : null}
      </td>
      <td className="px-3 py-3 align-top"><StatusIndicator label={sourceLabel} tone="neutral" /></td>
      <td className="px-3 py-3 align-top"><StatusIndicator label={job.status} tone={jobStatusTone(job.status)} dot /></td>
      <td className="px-3 py-3 align-top"><Progress value={job.progress} label={t("runtime.progress")} showValue /></td>
      <td className="px-3 py-3 align-top text-xs leading-5 text-ink-muted">{formatJobDate(job.updated_at)}</td>
      <td className="px-3 py-3 text-right align-top">
        <div className="flex items-center justify-end gap-1">
          {failed ? (
            <IconButton
              label={t("runtime.retryJob")}
              loading={actionId === `retry:${job.job_id}`}
              loadingLabel={t("runtime.working")}
              onClick={() => void onRetry(job)}
            >
              <RefreshCw className="h-4 w-4" />
            </IconButton>
          ) : null}
          {active ? (
            <IconButton label={t("runtime.cancelJob")} onClick={() => onRequestCancel(job)} className="hover:text-danger">
              <Square className="h-3.5 w-3.5" />
            </IconButton>
          ) : null}
          <IconButton label={t("runtime.viewJobDetails", { title: job.title || job.job_id })} onClick={onOpen}>
            <Eye className="h-4 w-4" />
          </IconButton>
        </div>
      </td>
    </tr>
  );
}

function RuntimeJobSkeletonRows() {
  return (
    <>
      {[0, 1, 2].map((row) => (
        <tr key={row} aria-hidden="true" className="border-t border-[hsl(var(--border-subtle))]">
          <td colSpan={6} className="px-4 py-4">
            <div className="h-8 animate-pulse rounded-md bg-surface-2" />
          </td>
        </tr>
      ))}
    </>
  );
}

function classifyRuntimeJob(job: RuntimeJob): ClassifiedRuntimeJob {
  const haystack = `${job.kind} ${job.title || ""} ${job.job_id}`.toLocaleLowerCase();
  let source: RuntimeJobSource = "other";
  if (haystack.includes("agent") || haystack.includes("attempt") || haystack.includes("session")) source = "agent";
  else if (haystack.includes("rag") || haystack.includes("knowledge") || haystack.includes("ingestion") || haystack.includes("embedding")) source = "rag";
  else if (haystack.includes("web") || haystack.includes("crawl") || haystack.includes("url")) source = "web";
  else if (haystack.includes("backtest") || haystack.includes("bench") || haystack.includes("alpha") || haystack.includes("compare")) source = "backtest";
  return { raw: job, source };
}

function matchesFilters(
  job: ClassifiedRuntimeJob,
  source: RuntimeJobSource | "all",
  status: RuntimeJobStatusFilter,
  query: string,
): boolean {
  if (source !== "all" && job.source !== source) return false;
  if (status === "active" && !isActiveJob(job.raw.status)) return false;
  if (status === "failed" && !isFailedJob(job.raw.status)) return false;
  if (status === "completed" && !isCompletedJob(job.raw.status)) return false;
  if (status === "cancelled" && job.raw.status !== "cancelled") return false;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return true;
  return `${job.raw.title || ""} ${job.raw.job_id} ${job.raw.kind}`.toLocaleLowerCase().includes(normalizedQuery);
}

function summarizeJobs(jobs: RuntimeJob[]) {
  return {
    total: jobs.length,
    active: jobs.filter((job) => isActiveJob(job.status)).length,
    failed: jobs.filter((job) => isFailedJob(job.status)).length,
    completed: jobs.filter((job) => isCompletedJob(job.status)).length,
  };
}
