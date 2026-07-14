import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  OctagonX,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Wifi,
  WifiOff,
} from "lucide-react";
import { api, type LiveBrokerStatus, type LiveMandateLimits, type LiveStatus, type RuntimeJob } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Metric, Panel, SectionHeader } from "@/components/ui/Panel";
import { StatusIndicator, type StatusTone } from "@/components/ui/Status";
import { RuntimeJobsWorkspace } from "@/pages/runtime/RuntimeJobsWorkspace";
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
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [jobActionId, setJobActionId] = useState<string | null>(null);
  const [jobActionError, setJobActionError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const activeRequestRef = useRef<{ id: number; controller: AbortController } | null>(null);
  const requestSeqRef = useRef(0);
  const jobsRequestSeqRef = useRef(0);
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
    const requestId = jobsRequestSeqRef.current + 1;
    jobsRequestSeqRef.current = requestId;
    setJobsLoading(true);
    try {
      const next = await api.listRuntimeJobs();
      if (!mountedRef.current || jobsRequestSeqRef.current !== requestId) return;
      setJobs(Array.isArray(next) ? next : []);
      setJobsError(null);
    } catch (err) {
      if (!mountedRef.current || jobsRequestSeqRef.current !== requestId) return;
      setJobsError(err instanceof Error ? err.message : tRef.current("runtime.jobsUnavailable"));
    } finally {
      if (mountedRef.current && jobsRequestSeqRef.current === requestId) setJobsLoading(false);
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
      jobsRequestSeqRef.current += 1;
      activeRequestRef.current?.controller.abort();
      activeRequestRef.current = null;
      window.clearInterval(pollTimer);
      window.clearInterval(clockTimer);
    };
  }, [loadStatus, loadJobs]);

  const summary = useMemo(() => summarizeRuntime(status), [status]);
  const refreshAll = () => {
    loadStatus("refresh");
    void loadJobs();
  };

  const retryJob = async (job: RuntimeJob) => {
    setJobActionId(`retry:${job.job_id}`);
    setJobActionError(null);
    try {
      await api.retryRuntimeJob(job.job_id);
      await loadJobs();
    } catch (err) {
      setJobActionError(err instanceof Error ? err.message : tRef.current("runtime.actionFailed"));
    } finally {
      setJobActionId(null);
    }
  };

  const cancelJob = async (job: RuntimeJob) => {
    setJobActionId(`cancel:${job.job_id}`);
    setJobActionError(null);
    try {
      await api.cancelRuntimeJob(job.job_id);
      await loadJobs();
    } catch (err) {
      setJobActionError(err instanceof Error ? err.message : tRef.current("runtime.actionFailed"));
    } finally {
      setJobActionId(null);
    }
  };

  return (
    <div data-page-enter className="min-h-full bg-canvas px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-4 border-b border-[hsl(var(--border-subtle))] pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-primary">
              <Activity className="h-3.5 w-3.5" aria-hidden="true" />
              {t("runtime.monitorBadge")}
            </div>
            <h1 className="text-2xl font-semibold leading-8 text-ink-strong">{t("runtime.title")}</h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-ink-muted">{t("runtime.subtitle")}</p>
          </div>
          <Button
            variant="secondary"
            onClick={refreshAll}
            loading={refreshing}
            loadingLabel={t("runtime.refreshing")}
            leftIcon={<RefreshCw className="h-4 w-4" />}
          >
            {t("runtime.refresh")}
          </Button>
        </header>

        <RuntimeJobsWorkspace
          jobs={jobs}
          loading={jobsLoading}
          error={jobsError}
          actionError={jobActionError}
          actionId={jobActionId}
          onRetry={retryJob}
          onCancel={cancelJob}
          onDismissActionError={() => setJobActionError(null)}
        />

        <Panel padding="none" className="overflow-hidden shadow-xs" aria-labelledby="connector-runtime-title">
          <div className="px-4 py-4 sm:px-5">
            <SectionHeader
              title={<span id="connector-runtime-title">{t("runtime.connectorTitle")}</span>}
              description={t("runtime.connectorDescription")}
              actions={status ? (
                <StatusIndicator
                  label={status.global_halted ? t("runtime.halted") : t("runtime.clear")}
                  tone={status.global_halted ? "danger" : "success"}
                  dot
                />
              ) : undefined}
            />
          </div>

          {loading ? (
            <div className="grid grid-cols-2 border-t border-[hsl(var(--border-subtle))] sm:grid-cols-4">
              {[1, 2, 3, 4].map((item) => (
                <div key={item} className="h-24 animate-pulse border-r border-[hsl(var(--border-subtle))] bg-surface-2/60 last:border-r-0" />
              ))}
            </div>
          ) : null}

          {!loading && error ? (
            <div className="border-t border-[hsl(var(--border-subtle))] p-4 sm:p-5">
              <div className="flex items-start gap-3 rounded-md border border-warning/25 bg-warning/8 p-3.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-warning">{t("runtime.unavailableTitle")}</div>
                  <p className="mt-1 break-words text-sm text-ink">{error}</p>
                  <p className="mt-1 text-xs leading-5 text-ink-muted">{t("runtime.unavailableHint")}</p>
                </div>
              </div>
            </div>
          ) : null}

          {!loading && !error && status ? (
            <>
              <div className="grid grid-cols-2 border-y border-[hsl(var(--border-subtle))] bg-surface-2/55 sm:grid-cols-4 sm:divide-x sm:divide-[hsl(var(--border-subtle))]">
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
              </div>

              {status.brokers.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <ShieldOff className="mx-auto h-7 w-7 text-ink-disabled" aria-hidden="true" />
                  <h2 className="mt-3 text-sm font-medium text-ink-strong">{t("runtime.noProfilesTitle")}</h2>
                  <p className="mt-1 text-xs text-ink-muted">{t("runtime.noProfilesBody")}</p>
                </div>
              ) : (
                <div className="divide-y divide-[hsl(var(--border-subtle))]">
                  {status.brokers.map((broker) => (
                    <BrokerRuntimeCard key={broker.auth.broker} broker={broker} globalHalted={status.global_halted} t={t} nowMs={nowMs} />
                  ))}
                </div>
              )}
            </>
          ) : null}
        </Panel>
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
    <div className="flex min-w-0 items-start justify-between gap-3 px-4 py-3.5 sm:px-5">
      <Metric label={label} value={value} />
      <span className={cn(
        "mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-surface-1 shadow-xs",
        tone === "success" && "border-success/25 text-success",
        tone === "danger" && "border-danger/25 text-danger",
        tone === "neutral" && "border-border text-ink-muted",
      )}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
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
    <article className="px-4 py-4 sm:px-5">
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
          <p className="mt-1.5 text-xs leading-5 text-ink-muted">
            {broker.auth.is_live_broker ? t("runtime.recognizedProfile") : t("runtime.unknownProfile")} · {t("runtime.lastTick")}{" "}
            {formatLastTick(broker.runner?.last_tick, broker.runner?.last_tick_age_seconds, t, nowMs)}
          </p>
        </div>
        <StatusPill label={risk.label} tone={risk.tone} />
      </div>

      <div className="mt-4 grid divide-y divide-[hsl(var(--border-subtle))] border-t border-[hsl(var(--border-subtle))] md:grid-cols-3 md:divide-x md:divide-y-0">
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
    <section className="min-w-0 py-3 first:pl-0 md:px-4 md:first:pl-0 md:last:pr-0">
      <div className="mb-3 flex items-center gap-2 text-xs font-medium text-ink-muted">
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
      <div className="text-xs text-ink-muted">{label}</div>
      <div className="mt-0.5 break-words font-mono text-sm text-ink-strong">{value || "-"}</div>
    </div>
  );
}

function StatusPill({ label, tone }: { label: string; tone: "success" | "danger" | "warning" | "neutral" }) {
  return <StatusIndicator label={label} tone={tone as StatusTone} dot={tone !== "neutral"} />;
}

function summarizeRuntime(status: LiveStatus | null) {
  const brokers = status?.brokers || [];
  return {
    brokerCount: brokers.length,
    authorizedCount: brokers.filter((broker) => broker.auth.oauth_token_present).length,
    runningCount: brokers.filter((broker) => broker.runner?.alive).length,
  };
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
