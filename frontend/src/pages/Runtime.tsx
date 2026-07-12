import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  OctagonX,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Wifi,
  WifiOff,
} from "lucide-react";
import { api, type LiveBrokerStatus, type LiveMandateLimits, type LiveStatus, type RuntimeJob } from "@/lib/api";
import { cn } from "@/lib/utils";

const RUNTIME_POLL_INTERVAL_MS = 15_000;
const RUNTIME_CLOCK_INTERVAL_MS = 1_000;

export function Runtime() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<RuntimeJob[]>([]);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [jobActionId, setJobActionId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const activeRequestRef = useRef<{ id: number; controller: AbortController } | null>(null);
  const requestSeqRef = useRef(0);
  const mountedRef = useRef(false);
  const tRef = useRef(t);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const loadStatus = useCallback(async (mode: "initial" | "refresh" = "refresh") => {
    const requestId = requestSeqRef.current + 1;
    requestSeqRef.current = requestId;
    activeRequestRef.current?.controller.abort();
    const controller = new AbortController();
    activeRequestRef.current = { id: requestId, controller };

    if (mode === "initial") setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const next = await api.getLiveStatus(controller.signal);
      if (!mountedRef.current || !isCurrentStatusRequest(activeRequestRef.current, requestId, controller)) return;
      setStatus(next);
    } catch (err) {
      if (controller.signal.aborted) return;
      if (!mountedRef.current || !isCurrentStatusRequest(activeRequestRef.current, requestId, controller)) return;
      console.warn("Failed to load runtime status", err);
      setStatus(null);
      setError(err instanceof Error ? err.message : tRef.current("runtime.statusUnavailable"));
    } finally {
      if (!mountedRef.current || !isCurrentStatusRequest(activeRequestRef.current, requestId, controller)) return;
      activeRequestRef.current = null;
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadJobs = useCallback(async () => {
    try {
      const next = await api.listRuntimeJobs();
      if (!mountedRef.current) return;
      setJobs(Array.isArray(next) ? next : []);
      setJobsError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setJobs([]);
      setJobsError(err instanceof Error ? err.message : tRef.current("runtime.jobsUnavailable"));
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    loadStatus("initial");
    void loadJobs();
    const pollTimer = window.setInterval(() => {
      loadStatus("refresh");
      void loadJobs();
    }, RUNTIME_POLL_INTERVAL_MS);
    const clockTimer = window.setInterval(() => setNowMs(Date.now()), RUNTIME_CLOCK_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      requestSeqRef.current += 1;
      activeRequestRef.current?.controller.abort();
      activeRequestRef.current = null;
      window.clearInterval(pollTimer);
      window.clearInterval(clockTimer);
    };
  }, [loadStatus, loadJobs]);

  const summary = useMemo(() => summarizeRuntime(status), [status]);
  const jobSummary = useMemo(() => summarizeJobs(jobs), [jobs]);

  const refreshAll = () => {
    loadStatus("refresh");
    void loadJobs();
  };

  const retryJob = async (job: RuntimeJob) => {
    setJobActionId(`retry:${job.job_id}`);
    try {
      await api.retryRuntimeJob(job.job_id);
      await loadJobs();
    } finally {
      setJobActionId(null);
    }
  };

  const cancelJob = async (job: RuntimeJob) => {
    setJobActionId(`cancel:${job.job_id}`);
    try {
      await api.cancelRuntimeJob(job.job_id);
      await loadJobs();
    } finally {
      setJobActionId(null);
    }
  };

  return (
    <div className="min-h-screen p-6 lg:p-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <section className="flex flex-col gap-4 border-b pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-xs font-medium text-muted-foreground">
              <Activity className="h-3.5 w-3.5" />
              {t("runtime.monitorBadge")}
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">{t("runtime.title")}</h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                {t("runtime.subtitlePre")} <span className="font-mono">/live/status</span>
                {t("runtime.subtitlePost")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={refreshAll}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition hover:bg-muted disabled:opacity-50"
          >
            {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {t("runtime.refresh")}
          </button>
        </section>

        {loading ? (
          <div className="grid gap-3 md:grid-cols-4">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="h-24 animate-pulse rounded-md border bg-muted/40" />
            ))}
          </div>
        ) : null}

        {!loading && error ? (
          <section className="rounded-md border border-warning/30 bg-warning/10 p-5">
            <div className="flex items-center gap-2 font-medium text-warning">
              <AlertTriangle className="h-5 w-5" />
              {t("runtime.unavailableTitle")}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
            <p className="mt-2 text-xs text-muted-foreground">{t("runtime.unavailableHint")}</p>
          </section>
        ) : null}

        {!loading && !error && status ? (
          <>
            <section className="grid gap-3 md:grid-cols-4">
              <SummaryTile
                label={t("runtime.globalHalt")}
                value={status.global_halted ? t("runtime.halted") : t("runtime.clear")}
                tone={status.global_halted ? "danger" : "success"}
                icon={status.global_halted ? OctagonX : CheckCircle2}
              />
              <SummaryTile label={t("runtime.brokers")} value={String(summary.brokerCount)} tone="neutral" icon={Activity} />
              <SummaryTile
                label={t("runtime.authorized")}
                value={String(summary.authorizedCount)}
                tone={summary.authorizedCount > 0 ? "success" : "neutral"}
                icon={summary.authorizedCount > 0 ? Wifi : WifiOff}
              />
              <SummaryTile
                label={t("runtime.runners")}
                value={t("runtime.running", { count: summary.runningCount })}
                tone={summary.runningCount > 0 && !status.global_halted ? "success" : "neutral"}
                icon={summary.runningCount > 0 ? Activity : Clock3}
              />
            </section>

            {status.brokers.length === 0 ? (
              <section className="rounded-md border border-dashed p-8 text-center">
                <ShieldOff className="mx-auto h-8 w-8 text-muted-foreground" />
                <h2 className="mt-3 font-medium">{t("runtime.noProfilesTitle")}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{t("runtime.noProfilesBody")}</p>
              </section>
            ) : (
              <section className="grid gap-4">
                {status.brokers.map((broker) => (
                  <BrokerRuntimeCard key={broker.auth.broker} broker={broker} globalHalted={status.global_halted} t={t} nowMs={nowMs} />
                ))}
              </section>
            )}
          </>
        ) : null}

        {!loading ? (
          <RuntimeJobsPanel
            jobs={jobs}
            summary={jobSummary}
            error={jobsError}
            actionId={jobActionId}
            onRetry={retryJob}
            onCancel={cancelJob}
          />
        ) : null}
      </div>
    </div>
  );
}

interface SummaryTileProps {
  label: string;
  value: string;
  tone: "success" | "danger" | "neutral";
  icon: typeof Activity;
}

function isCurrentStatusRequest(
  activeRequest: { id: number; controller: AbortController } | null,
  requestId: number,
  controller: AbortController,
): boolean {
  return activeRequest?.id === requestId && activeRequest.controller === controller;
}

function SummaryTile({ label, value, tone, icon: Icon }: SummaryTileProps) {
  return (
    <div className="rounded-md border p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase text-muted-foreground">{label}</span>
        <Icon
          className={cn(
            "h-4 w-4",
            tone === "success" && "text-success",
            tone === "danger" && "text-danger",
            tone === "neutral" && "text-muted-foreground",
          )}
        />
      </div>
      <div
        className={cn(
          "mt-3 text-2xl font-semibold",
          tone === "success" && "text-success",
          tone === "danger" && "text-danger",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function BrokerRuntimeCard({
  broker,
  globalHalted,
  t,
  nowMs,
}: {
  broker: LiveBrokerStatus;
  globalHalted: boolean;
  t: TFunction;
  nowMs: number;
}) {
  const brokerKey = broker.auth.broker;
  const runnerAlive = broker.runner?.alive ?? false;
  const halted = globalHalted || broker.halted;
  const mandate = broker.mandate ?? null;
  const risk = deriveRiskState(broker, globalHalted, t);
  const mandateCountdown = formatCountdown(mandate?.expires_at, t, nowMs);

  return (
    <article className="rounded-md border p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold capitalize">{brokerKey}</h2>
            <StatusPill
              label={broker.auth.oauth_token_present ? t("runtime.authPresent") : t("runtime.authMissing")}
              tone={broker.auth.oauth_token_present ? "success" : "neutral"}
            />
            <StatusPill
              label={runnerAlive ? t("runtime.runnerAlive") : t("runtime.runnerStopped")}
              tone={runnerAlive ? "success" : "neutral"}
            />
            {halted ? <StatusPill label={t("runtime.haltedPill")} tone="danger" /> : null}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {broker.auth.is_live_broker ? t("runtime.recognizedProfile") : t("runtime.unknownProfile")} · {t("runtime.lastTick")}{" "}
            {formatLastTick(broker.runner?.last_tick, broker.runner?.last_tick_age_seconds, t, nowMs)}
          </p>
        </div>
        <StatusPill label={risk.label} tone={risk.tone} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <RuntimePanel title={t("runtime.authorization")} icon={broker.auth.oauth_token_present ? Wifi : WifiOff}>
          <KeyValue label={t("runtime.oauthToken")} value={broker.auth.oauth_token_present ? t("runtime.present") : t("runtime.missing")} />
          <KeyValue label={t("runtime.profileType")} value={broker.auth.is_live_broker ? t("runtime.recognized") : t("runtime.unknown")} />
        </RuntimePanel>

        <RuntimePanel title={t("runtime.mandate")} icon={mandate ? ShieldCheck : ShieldOff}>
          {mandate ? (
            <>
              <KeyValue label={t("runtime.account")} value={mandate.account_ref || t("runtime.unrecorded")} />
              <KeyValue label={t("runtime.expiry")} value={mandate.expired ? t("runtime.expired") : mandateCountdown} />
              <KeyValue label={t("runtime.limits")} value={summarizeLimits(mandate.limits, t)} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t("runtime.noMandate")}</p>
          )}
        </RuntimePanel>

        <RuntimePanel title={t("runtime.riskStateTitle")} icon={risk.icon}>
          <p className="text-sm text-muted-foreground">{risk.description}</p>
        </RuntimePanel>
      </div>
    </article>
  );
}

function RuntimePanel({ title, icon: Icon, children }: { title: string; icon: typeof Activity; children: ReactNode }) {
  return (
    <section className="rounded-md border bg-muted/20 p-3">
      <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function KeyValue({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase text-muted-foreground">{label}</div>
      <div className="font-mono text-sm">{value || "-"}</div>
    </div>
  );
}

function StatusPill({ label, tone }: { label: string; tone: "success" | "danger" | "warning" | "neutral" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-2 py-0.5 text-xs font-medium",
        tone === "success" && "bg-success/10 text-success",
        tone === "danger" && "bg-danger/10 text-danger",
        tone === "warning" && "bg-warning/10 text-warning",
        tone === "neutral" && "bg-muted text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

function summarizeRuntime(status: LiveStatus | null) {
  const brokers = status?.brokers || [];
  return {
    brokerCount: brokers.length,
    authorizedCount: brokers.filter((broker) => broker.auth.oauth_token_present).length,
    runningCount: brokers.filter((broker) => broker.runner?.alive).length,
  };
}

function summarizeJobs(jobs: RuntimeJob[]) {
  return {
    total: jobs.length,
    running: jobs.filter((job) => ["queued", "pending", "running"].includes(job.status)).length,
    failed: jobs.filter((job) => ["failed", "error"].includes(job.status)).length,
  };
}

function RuntimeJobsPanel({
  jobs,
  summary,
  error,
  actionId,
  onRetry,
  onCancel,
}: {
  jobs: RuntimeJob[];
  summary: { total: number; running: number; failed: number };
  error: string | null;
  actionId: string | null;
  onRetry: (job: RuntimeJob) => void;
  onCancel: (job: RuntimeJob) => void;
}) {
  const { t } = useTranslation();
  const [sourceFilter, setSourceFilter] = useState<DurableJobSource | "all">("all");
  const [statusFilter, setStatusFilter] = useState<DurableJobStatusFilter>("all");
  const durableJobs = useMemo(() => jobs.map(normalizeDurableJob), [jobs]);
  const sourceSummary = useMemo(() => summarizeDurableJobSources(durableJobs), [durableJobs]);
  const visibleJobs = useMemo(
    () => durableJobs.filter((job) => matchesDurableJobFilters(job, sourceFilter, statusFilter)),
    [durableJobs, sourceFilter, statusFilter],
  );

  return (
    <section className="rounded-md border bg-card p-4">
      <div className="mb-4 flex flex-col gap-1">
        <h2 className="text-base font-semibold">{t("runtime.jobsTitle")}</h2>
        <p className="text-sm text-muted-foreground">{t("runtime.jobsDescription")}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <SummaryTile label={t("runtime.jobsTotal")} value={t("runtime.jobsCount", { count: summary.total })} tone="neutral" icon={Activity} />
        <SummaryTile label={t("runtime.jobsRunning")} value={t("runtime.jobsRunningCount", { count: summary.running })} tone={summary.running > 0 ? "success" : "neutral"} icon={Clock3} />
        <SummaryTile label={t("runtime.jobsFailed")} value={t("runtime.jobsFailedCount", { count: summary.failed })} tone={summary.failed > 0 ? "danger" : "neutral"} icon={AlertTriangle} />
      </div>
      {error ? (
        <div className="mt-4 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          {error}
        </div>
      ) : null}
      {!error && jobs.length === 0 ? (
        <div className="mt-4 rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          {t("runtime.noJobs")}
        </div>
      ) : null}
      {!error && jobs.length > 0 ? (
        <div className="mt-4 space-y-4">
          <div className="rounded-md border bg-muted/10 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h3 className="text-sm font-semibold">{t("runtime.durableTitle")}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{t("runtime.durableDescription")}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <label className="grid gap-1 text-xs text-muted-foreground">
                  <span>{t("runtime.sourceFilter")}</span>
                  <select
                    aria-label={t("runtime.sourceFilter")}
                    value={sourceFilter}
                    onChange={(event) => setSourceFilter(event.target.value as DurableJobSource | "all")}
                    className="h-9 rounded-md border bg-background px-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="all">{t("runtime.jobSource.all")}</option>
                    <option value="agent">{t("runtime.jobSource.agent")}</option>
                    <option value="rag">{t("runtime.jobSource.rag")}</option>
                    <option value="web">{t("runtime.jobSource.web")}</option>
                    <option value="backtest">{t("runtime.jobSource.backtest")}</option>
                    <option value="other">{t("runtime.jobSource.other")}</option>
                  </select>
                </label>
                <label className="grid gap-1 text-xs text-muted-foreground">
                  <span>{t("runtime.statusFilter")}</span>
                  <select
                    aria-label={t("runtime.statusFilter")}
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value as DurableJobStatusFilter)}
                    className="h-9 rounded-md border bg-background px-2 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="all">{t("runtime.jobStatusFilter.all")}</option>
                    <option value="active">{t("runtime.jobStatusFilter.active")}</option>
                    <option value="failed">{t("runtime.jobStatusFilter.failed")}</option>
                    <option value="completed">{t("runtime.jobStatusFilter.completed")}</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <DurableSourceCard label={t("runtime.jobSource.agent")} count={sourceSummary.agent} />
              <DurableSourceCard label={t("runtime.jobSource.rag")} count={sourceSummary.rag} />
              <DurableSourceCard label={t("runtime.jobSource.web")} count={sourceSummary.web} />
              <DurableSourceCard label={t("runtime.jobSource.backtest")} count={sourceSummary.backtest} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {t("runtime.durableCount", { shown: visibleJobs.length, total: durableJobs.length })}
            </p>
          </div>

          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">{t("runtime.job")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("runtime.source")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("runtime.status")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("runtime.progress")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("runtime.updated")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("runtime.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {visibleJobs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-sm text-muted-foreground">
                      {t("runtime.noDurableMatches")}
                    </td>
                  </tr>
                ) : (
                  visibleJobs.map((durableJob) => {
                    const job = durableJob.raw;
                    return (
                      <tr key={job.job_id} className="border-t transition hover:bg-muted/20">
                        <td className="px-3 py-2 align-top">
                          <div className="font-medium">{job.title || job.job_id}</div>
                          <div className="font-mono text-xs text-muted-foreground">{job.kind} / {job.job_id}</div>
                          {job.error ? <div className="mt-1 max-w-md text-xs text-danger">{job.error}</div> : null}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <StatusPill label={t(`runtime.jobSource.${durableJob.source}`)} tone="neutral" />
                        </td>
                        <td className="px-3 py-2 align-top">
                          <StatusPill label={job.status} tone={jobStatusTone(job.status)} />
                        </td>
                        <td className="px-3 py-2 align-top">
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-28 overflow-hidden rounded-full bg-muted">
                              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, Number(job.progress || 0)))}%` }} />
                            </div>
                            <span className="text-xs tabular-nums text-muted-foreground">{Math.round(Number(job.progress || 0))}%</span>
                          </div>
                        </td>
                        <td className="px-3 py-2 align-top text-xs text-muted-foreground">
                          {formatJobDate(job.updated_at)}
                        </td>
                        <td className="px-3 py-2 text-right align-top">
                          <div className="flex flex-wrap justify-end gap-2">
                            {["failed", "error"].includes(job.status) ? (
                              <button
                                type="button"
                                onClick={() => onRetry(job)}
                                disabled={actionId === `retry:${job.job_id}`}
                                className="rounded-md border px-2.5 py-1.5 text-xs font-medium transition hover:bg-muted disabled:opacity-60"
                              >
                                {actionId === `retry:${job.job_id}` ? t("runtime.working") : t("runtime.retryJob")}
                              </button>
                            ) : null}
                            {["queued", "pending", "running"].includes(job.status) ? (
                              <button
                                type="button"
                                onClick={() => onCancel(job)}
                                disabled={actionId === `cancel:${job.job_id}`}
                                className="rounded-md border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-destructive/40 hover:text-destructive disabled:opacity-60"
                              >
                                {actionId === `cancel:${job.job_id}` ? t("runtime.working") : t("runtime.cancelJob")}
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function jobStatusTone(status: string): "success" | "danger" | "warning" | "neutral" {
  if (["completed", "done"].includes(status)) return "success";
  if (["failed", "error"].includes(status)) return "danger";
  if (["queued", "pending", "running"].includes(status)) return "warning";
  return "neutral";
}

type DurableJobSource = "agent" | "rag" | "web" | "backtest" | "other";
type DurableJobStatusFilter = "all" | "active" | "failed" | "completed";

interface DurableJob {
  raw: RuntimeJob;
  source: DurableJobSource;
}

function normalizeDurableJob(job: RuntimeJob): DurableJob {
  const kind = job.kind.toLowerCase();
  const title = (job.title || "").toLowerCase();
  const id = job.job_id.toLowerCase();
  const haystack = `${kind} ${title} ${id}`;
  let source: DurableJobSource = "other";
  if (haystack.includes("agent") || haystack.includes("attempt") || haystack.includes("session")) source = "agent";
  else if (haystack.includes("rag") || haystack.includes("knowledge") || haystack.includes("ingestion") || haystack.includes("embedding")) source = "rag";
  else if (haystack.includes("web") || haystack.includes("crawl") || haystack.includes("url")) source = "web";
  else if (haystack.includes("backtest") || haystack.includes("bench") || haystack.includes("alpha") || haystack.includes("compare")) source = "backtest";
  return { raw: job, source };
}

function summarizeDurableJobSources(jobs: DurableJob[]) {
  return jobs.reduce(
    (summary, job) => {
      summary[job.source] += 1;
      return summary;
    },
    { agent: 0, rag: 0, web: 0, backtest: 0, other: 0 } as Record<DurableJobSource, number>,
  );
}

function matchesDurableJobFilters(job: DurableJob, source: DurableJobSource | "all", status: DurableJobStatusFilter): boolean {
  const sourceOk = source === "all" || job.source === source;
  if (!sourceOk) return false;
  if (status === "all") return true;
  if (status === "active") return ["queued", "pending", "running"].includes(job.raw.status);
  if (status === "failed") return ["failed", "error"].includes(job.raw.status);
  if (status === "completed") return ["completed", "done"].includes(job.raw.status);
  return true;
}

function DurableSourceCard({ label, count }: { label: string; count: number }) {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{count}</div>
    </div>
  );
}

function formatJobDate(value: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function deriveRiskState(broker: LiveBrokerStatus, globalHalted: boolean, t: TFunction): {
  label: string;
  tone: "success" | "danger" | "warning" | "neutral";
  icon: typeof Activity;
  description: string;
} {
  if (globalHalted || broker.halted) {
    return {
      label: t("runtime.riskHalted"),
      tone: "danger",
      icon: OctagonX,
      description: t("runtime.riskHaltedDesc"),
    };
  }
  if (broker.runner?.alive && broker.mandate && !broker.mandate.expired) {
    return {
      label: t("runtime.riskActive"),
      tone: "success",
      icon: Activity,
      description: t("runtime.riskActiveDesc"),
    };
  }
  if (broker.auth.oauth_token_present && broker.mandate && !broker.mandate.expired) {
    return {
      label: t("runtime.riskIdle"),
      tone: "warning",
      icon: Clock3,
      description: t("runtime.riskIdleDesc"),
    };
  }
  return {
    label: t("runtime.riskDormant"),
    tone: "neutral",
    icon: ShieldOff,
    description: t("runtime.riskDormantDesc"),
  };
}

function summarizeLimits(limits: LiveMandateLimits | undefined, t: TFunction): string {
  if (!limits) return t("runtime.limitsUnavailable");
  const parts: string[] = [];
  if (typeof limits.max_order_notional_usd === "number") parts.push(`${formatUsd(limits.max_order_notional_usd)}${t("runtime.perOrder")}`);
  if (typeof limits.max_total_exposure_usd === "number") parts.push(`${formatUsd(limits.max_total_exposure_usd)} ${t("runtime.exposure")}`);
  if (typeof limits.max_trades_per_day === "number") parts.push(`${limits.max_trades_per_day}${t("runtime.perDay")}`);
  if (typeof limits.max_leverage === "number") parts.push(`${limits.max_leverage}${t("runtime.leverageSuffix")}`);
  if (limits.allowed_instruments?.length) parts.push(limits.allowed_instruments.join(", "));
  return parts.join(" · ") || t("runtime.limitsUnavailable");
}

function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function formatCountdown(iso: string | undefined, t: TFunction, nowMs: number): string {
  if (!iso) return t("runtime.unknown");
  const target = new Date(iso).getTime();
  if (!Number.isFinite(target)) return t("runtime.unknown");
  const deltaSec = Math.round((target - nowMs) / 1000);
  if (deltaSec <= 0) return t("runtime.expired");
  const days = Math.floor(deltaSec / 86_400);
  const hours = Math.floor((deltaSec % 86_400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h`;
  if (deltaSec < 60) return `${deltaSec}s`;
  return `${Math.floor(deltaSec / 60)}m`;
}

function formatLastTick(
  value: string | number | null | undefined,
  ageSeconds: number | null | undefined,
  t: TFunction,
  nowMs: number,
): string {
  if (typeof ageSeconds === "number" && Number.isFinite(ageSeconds)) {
    if (ageSeconds < 60) return `${Math.round(ageSeconds)}s ${t("runtime.ago")}`;
    if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)}m ${t("runtime.ago")}`;
    return `${Math.floor(ageSeconds / 3600)}h ${t("runtime.ago")}`;
  }
  if (value == null || value === "") return t("runtime.never");
  const timestamp = typeof value === "number" ? normalizeEpochMs(value) : new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return t("runtime.unknown");
  const deltaSec = Math.round((nowMs - timestamp) / 1000);
  if (deltaSec < 60) return `${Math.max(0, deltaSec)}s ${t("runtime.ago")}`;
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m ${t("runtime.ago")}`;
  return `${Math.floor(deltaSec / 3600)}h ${t("runtime.ago")}`;
}

function normalizeEpochMs(value: number): number {
  if (value >= 1_000_000_000_000) return value;
  if (value >= 946_684_800 && value <= 4_102_444_800) return value * 1000;
  return Number.NaN;
}
