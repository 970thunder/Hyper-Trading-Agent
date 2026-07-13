import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Database,
  FileClock,
  Filter,
  KeyRound,
  ListChecks,
  Loader2,
  Search,
  ServerCog,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  api,
  type AuditLog,
  type CommercialKnowledgeBase,
  type CommercialModelProvider,
  type CommercialOrganization,
  type CommercialOrganizationMember,
  type CommercialPrincipal,
  type ModelUsage,
  type RuntimeJob,
} from "@/lib/api";
import { cn } from "@/lib/utils";

type AdminSnapshot = {
  principal: CommercialPrincipal | null;
  organization: CommercialOrganization | null;
  members: CommercialOrganizationMember[];
  providers: CommercialModelProvider[];
  knowledgeBases: CommercialKnowledgeBase[];
  jobs: RuntimeJob[];
  auditLogs: AuditLog[];
  usage: ModelUsage[];
};

type GovernanceRecordType = "member" | "model" | "knowledge" | "job" | "audit" | "usage";

type GovernanceRecord = {
  id: string;
  type: GovernanceRecordType;
  title: string;
  subtitle: string;
  detail: string;
  status: string;
  href: string;
  actionLabel: string;
};

const EMPTY_SNAPSHOT: AdminSnapshot = {
  principal: null,
  organization: null,
  members: [],
  providers: [],
  knowledgeBases: [],
  jobs: [],
  auditLogs: [],
  usage: [],
};

export function Admin() {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<AdminSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recordQuery, setRecordQuery] = useState("");
  const [recordType, setRecordType] = useState<GovernanceRecordType | "all">("all");
  const [recordStatus, setRecordStatus] = useState("all");
  const [selectedRecords, setSelectedRecords] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [principal, organization, members, providers, knowledgeBases, jobs, auditLogs, usage] = await Promise.all([
        api.getCommercialMe(),
        api.getCurrentOrganization(),
        api.listOrganizationMembers(),
        api.listCommercialModelProviders(),
        api.listKnowledgeBases(),
        api.listRuntimeJobs(),
        api.listAuditLogs(20),
        api.listModelUsage(50),
      ]);
      setSnapshot({ principal, organization, members, providers, knowledgeBases, jobs, auditLogs, usage });
    } catch (err) {
      setSnapshot(EMPTY_SNAPSHOT);
      setError(err instanceof Error ? err.message : t("admin.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const analytics = useMemo(() => summarizeAdmin(snapshot), [snapshot]);
  const governanceRecords = useMemo(() => buildGovernanceRecords(snapshot, t), [snapshot, t]);
  const filteredGovernanceRecords = useMemo(
    () => filterGovernanceRecords(governanceRecords, recordQuery, recordType, recordStatus),
    [governanceRecords, recordQuery, recordType, recordStatus],
  );
  const selectedGovernanceRecords = useMemo(
    () => governanceRecords.filter((record) => selectedRecords.includes(record.id)),
    [governanceRecords, selectedRecords],
  );
  const defaultProvider = snapshot.providers.find((provider) => Boolean(provider.is_default));
  const recentJobs = snapshot.jobs.slice(0, 5);
  const recentAudit = snapshot.auditLogs.slice(0, 6);
  const bulkHref = selectedGovernanceRecords[0]?.href || "/settings";

  return (
    <div className="min-h-screen bg-background p-5 lg:p-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <section className="surface-panel p-5 lg:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-md border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                <ShieldCheck className="h-3.5 w-3.5" />
                {t("admin.badge")}
              </div>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight">{t("admin.title")}</h1>
                <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">{t("admin.subtitle")}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition hover:bg-muted disabled:opacity-60"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
              {t("admin.refresh")}
            </button>
          </div>
        </section>

        {error ? (
          <section className="rounded-md border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4" />
              {t("admin.unavailable")}
            </div>
            <p className="mt-2 text-muted-foreground">{error}</p>
          </section>
        ) : null}

        {loading && !error ? (
          <div className="grid gap-3 md:grid-cols-4">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="h-28 animate-pulse rounded-md border bg-muted/40" />
            ))}
          </div>
        ) : null}

        {!loading && !error ? (
          <>
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <AdminMetric icon={UsersRound} label={t("admin.members")} value={String(analytics.memberCount)} helper={t("admin.privilegedUsers", { count: analytics.privilegedCount })} />
              <AdminMetric icon={Bot} label={t("admin.models")} value={String(analytics.enabledProviders)} helper={defaultProvider?.model || t("admin.noDefaultModel")} />
              <AdminMetric icon={Database} label={t("admin.knowledgeBases")} value={String(snapshot.knowledgeBases.length)} helper={t("admin.kbHelper")} />
              <AdminMetric icon={KeyRound} label={t("admin.tokens")} value={String(analytics.totalTokens)} helper={t("admin.usageWindow")} />
            </section>

            <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
              <div className="surface-panel p-4">
                <PanelHeader icon={ServerCog} title={t("admin.governanceTitle")} description={snapshot.organization?.name || t("admin.unknownOrganization")} />
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <HealthCard label={t("admin.failedJobs")} value={String(analytics.failedJobs)} tone={analytics.failedJobs > 0 ? "danger" : "success"} />
                  <HealthCard label={t("admin.runningJobs")} value={String(analytics.runningJobs)} tone={analytics.runningJobs > 0 ? "warning" : "neutral"} />
                  <HealthCard label={t("admin.disabledModels")} value={String(analytics.disabledProviders)} tone={analytics.disabledProviders > 0 ? "warning" : "success"} />
                </div>
                <div className="mt-4 grid gap-2 md:grid-cols-3">
                  <AdminLink to="/admin/models" label={t("admin.manageModels")} />
                  <AdminLink to="/knowledge" label={t("admin.manageKnowledge")} />
                  <AdminLink to="/admin/audit" label={t("admin.viewAudit")} />
                </div>
              </div>

              <div className="surface-panel p-4">
                <PanelHeader icon={FileClock} title={t("admin.recentAudit")} description={t("admin.recentAuditDesc")} />
                <div className="mt-4 space-y-2">
                  {recentAudit.length === 0 ? (
                    <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{t("admin.noAudit")}</p>
                  ) : (
                    recentAudit.map((row) => (
                      <div key={row.id} className="rounded-md border bg-muted/20 px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate text-sm font-medium">{row.action}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{formatDate(row.created_at)}</span>
                        </div>
                        <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                          {row.target_type || "-"} / {row.target_id || "-"}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </section>

            <section className="surface-panel p-4" aria-label={t("admin.recordsTitle")}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <PanelHeader icon={ListChecks} title={t("admin.recordsTitle")} description={t("admin.recordsDesc")} />
                {selectedRecords.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-primary">
                    <span className="font-medium">{t("admin.selectedCount", { count: selectedRecords.length })}</span>
                    <Link className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:opacity-90" to={bulkHref}>
                      {t("admin.bulkReview")}
                    </Link>
                    <button
                      type="button"
                      className="rounded-md border border-primary/25 px-2 py-1 text-xs font-medium transition hover:bg-primary/10"
                      onClick={() => setSelectedRecords([])}
                    >
                      {t("admin.clearSelection")}
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_180px]">
                <label className="relative block">
                  <span className="sr-only">{t("admin.searchLabel")}</span>
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={recordQuery}
                    onChange={(event) => setRecordQuery(event.target.value)}
                    placeholder={t("admin.searchPlaceholder")}
                    className="h-10 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                  />
                </label>
                <label className="block">
                  <span className="sr-only">{t("admin.typeFilter")}</span>
                  <select
                    aria-label={t("admin.typeFilter")}
                    value={recordType}
                    onChange={(event) => setRecordType(event.target.value as GovernanceRecordType | "all")}
                    className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="all">{t("admin.recordTypes.all")}</option>
                    <option value="member">{t("admin.recordTypes.member")}</option>
                    <option value="model">{t("admin.recordTypes.model")}</option>
                    <option value="knowledge">{t("admin.recordTypes.knowledge")}</option>
                    <option value="job">{t("admin.recordTypes.job")}</option>
                    <option value="audit">{t("admin.recordTypes.audit")}</option>
                    <option value="usage">{t("admin.recordTypes.usage")}</option>
                  </select>
                </label>
                <label className="relative block">
                  <Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <select
                    aria-label={t("admin.statusFilter")}
                    value={recordStatus}
                    onChange={(event) => setRecordStatus(event.target.value)}
                    className="h-10 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="all">{t("admin.statuses.all")}</option>
                    <option value="privileged">{t("admin.statuses.privileged")}</option>
                    <option value="default">{t("admin.statuses.default")}</option>
                    <option value="enabled">{t("admin.statuses.enabled")}</option>
                    <option value="disabled">{t("admin.statuses.disabled")}</option>
                    <option value="running">{t("admin.statuses.running")}</option>
                    <option value="failed">{t("admin.statuses.failed")}</option>
                    <option value="active">{t("admin.statuses.active")}</option>
                    <option value="audit">{t("admin.statuses.audit")}</option>
                  </select>
                </label>
              </div>

              <div className="mt-4 overflow-hidden rounded-md border">
                <div className="grid grid-cols-[44px_minmax(0,1fr)_132px_132px] gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-medium uppercase text-muted-foreground max-md:hidden">
                  <span />
                  <span>{t("admin.record")}</span>
                  <span>{t("admin.status")}</span>
                  <span>{t("admin.actions")}</span>
                </div>
                {filteredGovernanceRecords.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">{t("admin.noRecordMatches")}</p>
                ) : (
                  filteredGovernanceRecords.map((record) => {
                    const selected = selectedRecords.includes(record.id);
                    return (
                      <div
                        key={record.id}
                        className={cn(
                          "grid grid-cols-[32px_minmax(0,1fr)] gap-3 border-b px-3 py-3 transition last:border-b-0 hover:bg-muted/30 md:grid-cols-[44px_minmax(0,1fr)_132px_132px]",
                          selected && "bg-primary/5",
                        )}
                      >
                        <input
                          type="checkbox"
                          aria-label={t("admin.selectRecord", { title: record.title })}
                          checked={selected}
                          onChange={() => {
                            setSelectedRecords((current) =>
                              current.includes(record.id)
                                ? current.filter((id) => id !== record.id)
                                : [...current, record.id],
                            );
                          }}
                          className="mt-1 h-4 w-4 rounded border-muted-foreground/40 text-primary focus:ring-primary/30"
                        />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-medium">{record.title}</span>
                            <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                              {t(`admin.recordTypes.${record.type}`)}
                            </span>
                          </div>
                          <p className="mt-1 truncate text-xs text-muted-foreground">{record.subtitle}</p>
                          {record.detail ? <p className="mt-1 truncate text-xs text-muted-foreground/80">{record.detail}</p> : null}
                        </div>
                        <div className="flex items-start md:items-center">
                          <StatusBadge status={record.status} />
                        </div>
                        <div className="flex items-start md:items-center">
                          <Link
                            to={record.href}
                            className="rounded-md border px-2.5 py-1.5 text-xs font-medium transition hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
                          >
                            {record.actionLabel}
                          </Link>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {t("admin.recordCount", { shown: filteredGovernanceRecords.length, total: governanceRecords.length })}
              </p>
            </section>

            <section className="grid gap-4 xl:grid-cols-2">
              <DataPanel title={t("admin.modelInventory")} empty={t("admin.noModels")}>
                {snapshot.providers.slice(0, 6).map((provider) => (
                  <InventoryRow
                    key={provider.id}
                    title={provider.model}
                    subtitle={`${provider.provider} / ${provider.base_url}`}
                    badge={provider.is_default ? t("admin.defaultBadge") : provider.enabled ? t("admin.enabledBadge") : t("admin.disabledBadge")}
                    tone={provider.enabled ? "success" : "warning"}
                  />
                ))}
              </DataPanel>

              <DataPanel title={t("admin.runtimeJobs")} empty={t("admin.noJobs")}>
                {recentJobs.map((job) => (
                  <InventoryRow
                    key={job.job_id}
                    title={job.title || job.job_id}
                    subtitle={`${job.kind} / ${Math.round(Number(job.progress || 0))}%`}
                    badge={job.status}
                    tone={job.status === "failed" || job.status === "error" ? "danger" : job.status === "running" ? "warning" : "neutral"}
                  />
                ))}
              </DataPanel>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}

function summarizeAdmin(snapshot: AdminSnapshot) {
  return {
    memberCount: snapshot.members.length,
    privilegedCount: snapshot.members.filter((member) => member.role === "owner" || member.role === "admin").length,
    enabledProviders: snapshot.providers.filter((provider) => Boolean(provider.enabled)).length,
    disabledProviders: snapshot.providers.filter((provider) => !Boolean(provider.enabled)).length,
    runningJobs: snapshot.jobs.filter((job) => ["queued", "pending", "running"].includes(String(job.status))).length,
    failedJobs: snapshot.jobs.filter((job) => ["failed", "error"].includes(String(job.status))).length,
    totalTokens: snapshot.usage.reduce((sum, row) => sum + Number(row.total_tokens || 0), 0),
  };
}

function buildGovernanceRecords(snapshot: AdminSnapshot, t: TFunction): GovernanceRecord[] {
  const memberRecords = snapshot.members.map((member) => ({
    id: `member:${member.user_id}`,
    type: "member" as const,
    title: member.email,
    subtitle: member.display_name || member.user_id,
    detail: formatDate(member.created_at),
    status: member.role,
    href: "/admin/users",
    actionLabel: t("admin.reviewMember"),
  }));

  const modelRecords = snapshot.providers.map((provider) => ({
    id: `model:${provider.id}`,
    type: "model" as const,
    title: provider.model,
    subtitle: provider.provider,
    detail: provider.base_url,
    status: provider.is_default ? "default" : provider.enabled ? "enabled" : "disabled",
    href: "/admin/models",
    actionLabel: t("admin.reviewModel"),
  }));

  const knowledgeRecords = snapshot.knowledgeBases.map((knowledgeBase) => ({
    id: `knowledge:${knowledgeBase.id}`,
    type: "knowledge" as const,
    title: knowledgeBase.name,
    subtitle: knowledgeBase.description || knowledgeBase.id,
    detail: formatDate(knowledgeBase.updated_at || knowledgeBase.created_at),
    status: "active",
    href: "/knowledge",
    actionLabel: t("admin.reviewKnowledge"),
  }));

  const jobRecords = snapshot.jobs.map((job) => ({
    id: `job:${job.job_id}`,
    type: "job" as const,
    title: job.title || job.job_id,
    subtitle: job.kind,
    detail: job.error || `${Math.round(Number(job.progress || 0))}%`,
    status: String(job.status),
    href: "/admin/runtime",
    actionLabel: t("admin.openRuntime"),
  }));

  const auditRecords = snapshot.auditLogs.map((row) => ({
    id: `audit:${row.id}`,
    type: "audit" as const,
    title: row.action,
    subtitle: `${row.target_type || "-"} / ${row.target_id || "-"}`,
    detail: row.user_id || formatDate(row.created_at),
    status: "audit",
    href: "/admin/audit",
    actionLabel: t("admin.openAudit"),
  }));

  const usageRecords = snapshot.usage.map((row) => ({
    id: `usage:${row.id}`,
    type: "usage" as const,
    title: row.model,
    subtitle: row.provider,
    detail: `${row.total_tokens || 0} tokens / ${row.latency_ms || 0}ms`,
    status: "active",
    href: "/admin/usage",
    actionLabel: t("admin.openUsage"),
  }));

  return [...memberRecords, ...modelRecords, ...knowledgeRecords, ...jobRecords, ...auditRecords, ...usageRecords];
}

function filterGovernanceRecords(
  records: GovernanceRecord[],
  query: string,
  type: GovernanceRecordType | "all",
  status: string,
): GovernanceRecord[] {
  const normalizedQuery = query.trim().toLowerCase();
  return records.filter((record) => {
    const matchesType = type === "all" || record.type === type;
    const haystack = [record.title, record.subtitle, record.detail, record.status, record.type].join(" ").toLowerCase();
    const matchesQuery = !normalizedQuery || haystack.includes(normalizedQuery);
    const matchesStatus = status === "all" || statusMatches(record.status, status);
    return matchesType && matchesQuery && matchesStatus;
  });
}

function statusMatches(recordStatus: string, filter: string): boolean {
  const status = recordStatus.toLowerCase();
  if (filter === "failed") return status === "failed" || status === "error";
  if (filter === "running") return status === "running" || status === "pending" || status === "queued";
  if (filter === "privileged") return status === "owner" || status === "admin";
  return status === filter;
}

function AdminMetric({ icon: Icon, label, value, helper }: { icon: typeof Activity; label: string; value: string; helper: string }) {
  return (
    <div className="surface-panel p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="mt-3 text-2xl font-semibold tabular-nums">{value}</div>
      <p className="mt-1 truncate text-xs text-muted-foreground">{helper}</p>
    </div>
  );
}

function PanelHeader({ icon: Icon, title, description }: { icon: typeof Activity; title: string; description: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function HealthCard({ label, value, tone }: { label: string; value: string; tone: "success" | "warning" | "danger" | "neutral" }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-2 flex items-center gap-2 text-xl font-semibold tabular-nums",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning",
          tone === "danger" && "text-danger",
        )}
      >
        {tone === "success" ? <CheckCircle2 className="h-4 w-4" /> : null}
        {value}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "enabled" || status === "completed" || status === "done" || status === "active" || status === "default"
      ? "success"
      : status === "failed" || status === "error" || status === "disabled"
        ? "danger"
        : status === "running" || status === "pending" || status === "queued"
          ? "warning"
          : "neutral";
  return (
    <span
      className={cn(
        "rounded px-2 py-0.5 text-xs font-medium",
        tone === "success" && "bg-success/10 text-success",
        tone === "warning" && "bg-warning/10 text-warning",
        tone === "danger" && "bg-danger/10 text-danger",
        tone === "neutral" && "bg-muted text-muted-foreground",
      )}
    >
      {status}
    </span>
  );
}

function AdminLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="rounded-md border px-3 py-2 text-center text-sm font-medium transition hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
    >
      {label}
    </Link>
  );
}

function DataPanel({ title, empty, children }: { title: string; empty: string; children: ReactNode[] }) {
  const hasChildren = children.length > 0;
  return (
    <section className="surface-panel p-4">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="mt-4 space-y-2">
        {hasChildren ? children : <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{empty}</p>}
      </div>
    </section>
  );
}

function InventoryRow({ title, subtitle, badge, tone }: { title: string; subtitle: string; badge: string; tone: "success" | "warning" | "danger" | "neutral" }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{subtitle}</div>
      </div>
      <span
        className={cn(
          "shrink-0 rounded px-2 py-0.5 text-xs font-medium",
          tone === "success" && "bg-success/10 text-success",
          tone === "warning" && "bg-warning/10 text-warning",
          tone === "danger" && "bg-danger/10 text-danger",
          tone === "neutral" && "bg-muted text-muted-foreground",
        )}
      >
        {badge}
      </span>
    </div>
  );
}

function formatDate(value: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}
