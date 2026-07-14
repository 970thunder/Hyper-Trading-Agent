import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Archive,
  Building2,
  Database,
  FileClock,
  HardDrive,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  Trash2,
  UsersRound,
  Wrench,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  api,
  type PlatformAuditLog,
  type PlatformIngestionJob,
  type PlatformKnowledgeBase,
  type PlatformMaintenanceAction,
  type PlatformOrganization,
  type PlatformOperations,
  type PlatformRuntimeJob,
  type PlatformSummary,
  type PlatformUser,
  type PlatformWorkspaceArtifact,
} from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { StatusIndicator, type StatusTone } from "@/components/ui/Status";
import { Tab, TabList, TabPanel, Tabs } from "@/components/ui/Tabs";

type PlatformTab = "overview" | "users" | "organizations" | "knowledge" | "jobs" | "runtime" | "artifacts" | "operations" | "audit";

const EMPTY_SUMMARY: PlatformSummary = {
  users: 0,
  active_users: 0,
  organizations: 0,
  active_organizations: 0,
  platform_admins: 0,
  knowledge_bases: 0,
  knowledge_documents: 0,
  knowledge_chunks: 0,
  ingestion_jobs: 0,
  ingestion_jobs_active: 0,
  ingestion_jobs_failed: 0,
  model_calls: 0,
  audit_events: 0,
  commercial_db_bytes: 0,
  commercial_db_path: "",
};

const EMPTY_OPERATIONS: PlatformOperations = {
  database: {
    engine: "sqlite",
    file_bytes: 0,
    page_count: 0,
    page_size: 0,
    free_pages: 0,
    journal_mode: "",
    postgres_configured: false,
    table_counts: {},
  },
  runtime: {
    active: "",
    configured: "",
    available: false,
    redis_configured: false,
    postgres_configured: false,
    queue_name: "",
    fallback_reason: "",
    durable_job_db_bytes: 0,
  },
  storage: { uploads_bytes: 0, runs_bytes: 0, sessions_bytes: 0 },
};

export function PlatformAdmin() {
  const { t: translate, i18n } = useTranslation();
  const t = (key: string, options?: Record<string, unknown>): string => (
    translate(`settings.${key}` as never, options as never) as unknown as string
  );
  const [tab, setTab] = useState<PlatformTab>("overview");
  const [summary, setSummary] = useState<PlatformSummary>(EMPTY_SUMMARY);
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [organizations, setOrganizations] = useState<PlatformOrganization[]>([]);
  const [knowledgeBases, setKnowledgeBases] = useState<PlatformKnowledgeBase[]>([]);
  const [jobs, setJobs] = useState<PlatformIngestionJob[]>([]);
  const [runtimeJobs, setRuntimeJobs] = useState<PlatformRuntimeJob[]>([]);
  const [artifacts, setArtifacts] = useState<PlatformWorkspaceArtifact[]>([]);
  const [operations, setOperations] = useState<PlatformOperations>(EMPTY_OPERATIONS);
  const [auditLogs, setAuditLogs] = useState<PlatformAuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState("");
  const [error, setError] = useState("");
  const [maintenanceAction, setMaintenanceAction] = useState<PlatformMaintenanceAction | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextSummary, nextUsers, nextOrganizations, nextKnowledgeBases, nextJobs, nextRuntimeJobs, nextArtifacts, nextOperations, nextAudit] = await Promise.all([
        api.getPlatformSummary(),
        api.listPlatformUsers(),
        api.listPlatformOrganizations(),
        api.listPlatformKnowledgeBases(),
        api.listPlatformIngestionJobs(),
        api.listPlatformRuntimeJobs(),
        api.listPlatformWorkspaceArtifacts(),
        api.getPlatformOperations(),
        api.listPlatformAuditLogs(),
      ]);
      setSummary(nextSummary);
      setUsers(nextUsers);
      setOrganizations(nextOrganizations);
      setKnowledgeBases(nextKnowledgeBases);
      setJobs(nextJobs);
      setRuntimeJobs(nextRuntimeJobs);
      setArtifacts(nextArtifacts);
      setOperations(nextOperations);
      setAuditLogs(nextAudit);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("platformAdmin.loadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const locale = i18n.language === "zh-CN" ? "zh-CN" : i18n.language;
  const date = (value?: string | null) => value ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "-";
  const statusTone = (status: string | number | boolean): StatusTone => {
    if (status === "failed" || status === "error" || status === false || status === 0) return "danger";
    if (status === "running" || status === "pending") return "warning";
    if (status === "completed" || status === true || status === 1) return "success";
    return "neutral";
  };

  const stats = useMemo(() => [
    { key: "users", label: t("platformAdmin.stats.users"), value: summary.users, note: t("platformAdmin.stats.active", { count: summary.active_users }) },
    { key: "organizations", label: t("platformAdmin.stats.organizations"), value: summary.organizations, note: t("platformAdmin.stats.active", { count: summary.active_organizations }) },
    { key: "knowledge", label: t("platformAdmin.stats.knowledge"), value: summary.knowledge_bases, note: t("platformAdmin.stats.chunks", { count: summary.knowledge_chunks }) },
    { key: "jobs", label: t("platformAdmin.stats.jobs"), value: summary.ingestion_jobs, note: t("platformAdmin.stats.failed", { count: summary.ingestion_jobs_failed }) },
  ], [summary, t]);

  const toggleUser = async (user: PlatformUser) => {
    setActionId(`user-${user.user_id}`);
    setError("");
    try {
      const next = await api.updatePlatformUser(user.user_id, { is_active: !Boolean(user.is_active) });
      setUsers((current) => current.map((item) => item.user_id === next.user_id ? next : item));
      setSummary((current) => ({ ...current, active_users: current.active_users + (next.is_active ? 1 : -1) }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("platformAdmin.actionError"));
    } finally {
      setActionId("");
    }
  };

  const togglePlatformAdmin = async (user: PlatformUser) => {
    setActionId(`admin-${user.user_id}`);
    setError("");
    try {
      const next = user.is_platform_admin ? await api.revokePlatformAdmin(user.user_id) : await api.grantPlatformAdmin(user.user_id);
      setUsers((current) => current.map((item) => item.user_id === next.user_id ? next : item));
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("platformAdmin.actionError"));
    } finally {
      setActionId("");
    }
  };

  const toggleOrganization = async (organization: PlatformOrganization) => {
    setActionId(`organization-${organization.id}`);
    setError("");
    try {
      const next = await api.updatePlatformOrganization(organization.id, { is_active: !Boolean(organization.is_active) });
      setOrganizations((current) => current.map((item) => item.id === next.id ? next : item));
      setSummary((current) => ({ ...current, active_organizations: current.active_organizations + (next.is_active ? 1 : -1) }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("platformAdmin.actionError"));
    } finally {
      setActionId("");
    }
  };

  const removeKnowledgeBase = async (knowledgeBase: PlatformKnowledgeBase) => {
    if (!window.confirm(t("platformAdmin.deleteKnowledgeConfirm", { name: knowledgeBase.name }))) return;
    setActionId(`knowledge-${knowledgeBase.id}`);
    setError("");
    try {
      await api.deletePlatformKnowledgeBase(knowledgeBase.id);
      setKnowledgeBases((current) => current.filter((item) => item.id !== knowledgeBase.id));
      setSummary((current) => ({ ...current, knowledge_bases: Math.max(0, current.knowledge_bases - 1) }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("platformAdmin.actionError"));
    } finally {
      setActionId("");
    }
  };

  const maintenanceLabel = (action: PlatformMaintenanceAction) => t(`platformAdmin.maintenance.${action}`);

  const runMaintenance = async () => {
    if (!maintenanceAction) return;
    setActionId(`maintenance-${maintenanceAction}`);
    setError("");
    try {
      const result = await api.runPlatformMaintenance(maintenanceAction);
      setOperations((current) => ({ ...current, database: result.database }));
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("platformAdmin.actionError"));
    } finally {
      setActionId("");
      setMaintenanceAction(null);
    }
  };

  return (
    <div data-page-enter className="mx-auto w-full max-w-[1600px] px-3 py-3 sm:px-4 sm:py-5 lg:px-6">
      <section className="surface-panel overflow-hidden p-5 lg:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 text-xs font-medium text-primary"><ShieldCheck className="h-4 w-4" />{t("platformAdmin.eyebrow")}</div>
            <h1 className="mt-2 text-2xl font-semibold text-ink-strong lg:text-3xl">{t("platformAdmin.title")}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-muted">{t("platformAdmin.description")}</p>
          </div>
          <Button variant="secondary" loading={loading} onClick={() => void load()} leftIcon={<RefreshCw className="h-4 w-4" />}>{t("platformAdmin.refresh")}</Button>
        </div>
      </section>

      {error ? <div className="mt-4 rounded-md border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div> : null}

      <Tabs value={tab} onValueChange={(value) => setTab(value as PlatformTab)} className="mt-5">
        <TabList className="w-full overflow-x-auto sm:w-fit sm:flex-wrap">
          <Tab value="overview"><Activity className="h-3.5 w-3.5" />{t("platformAdmin.tabs.overview")}</Tab>
          <Tab value="users"><UsersRound className="h-3.5 w-3.5" />{t("platformAdmin.tabs.users")}</Tab>
          <Tab value="organizations"><Building2 className="h-3.5 w-3.5" />{t("platformAdmin.tabs.organizations")}</Tab>
          <Tab value="knowledge"><Database className="h-3.5 w-3.5" />{t("platformAdmin.tabs.knowledge")}</Tab>
          <Tab value="jobs"><FileClock className="h-3.5 w-3.5" />{t("platformAdmin.tabs.jobs")}</Tab>
          <Tab value="runtime"><ServerCog className="h-3.5 w-3.5" />{t("platformAdmin.tabs.runtime")}</Tab>
          <Tab value="artifacts"><Archive className="h-3.5 w-3.5" />{t("platformAdmin.tabs.artifacts")}</Tab>
          <Tab value="operations"><HardDrive className="h-3.5 w-3.5" />{t("platformAdmin.tabs.operations")}</Tab>
          <Tab value="audit"><ShieldCheck className="h-3.5 w-3.5" />{t("platformAdmin.tabs.audit")}</Tab>
        </TabList>

        <TabPanel value="overview" className="mt-5 space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {stats.map((stat) => <article key={stat.key} className="surface-panel p-4"><div className="text-xs text-ink-muted">{stat.label}</div><div className="mt-2 text-2xl font-semibold text-ink-strong">{stat.value.toLocaleString()}</div><div className="mt-1 text-xs text-ink-muted">{stat.note}</div></article>)}
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <section className="surface-panel p-4"><h2 className="text-sm font-semibold text-ink-strong">{t("platformAdmin.recentAudit")}</h2><AuditTable rows={auditLogs.slice(0, 8)} date={date} t={t} /></section>
            <section className="surface-panel p-4"><h2 className="text-sm font-semibold text-ink-strong">{t("platformAdmin.runtime")}</h2><dl className="mt-4 grid gap-3 text-sm"><Metric label={t("platformAdmin.runtimeActiveJobs")} value={summary.ingestion_jobs_active} /><Metric label={t("platformAdmin.runtimeModelCalls")} value={summary.model_calls} /><Metric label={t("platformAdmin.runtimeAuditEvents")} value={summary.audit_events} /><Metric label={t("platformAdmin.runtimeStorage")} value={formatBytes(summary.commercial_db_bytes)} /></dl></section>
          </div>
        </TabPanel>

        <TabPanel value="users" className="mt-5"><section className="surface-panel overflow-hidden"><TableHeader title={t("platformAdmin.usersTitle")} count={users.length} /><div className="overflow-x-auto"><table className="w-full min-w-[820px] text-sm"><thead><tr>{["user", "organizations", "platformRole", "status", "created", "actions"].map((key) => <th key={key} className="border-b border-border px-4 py-3 text-start text-xs font-medium text-ink-muted">{t(`platformAdmin.columns.${key}`)}</th>)}</tr></thead><tbody>{users.map((user) => <tr key={user.user_id} className="border-b border-border/70 last:border-0 hover:bg-surface-2/70"><td className="px-4 py-3"><div className="font-medium text-ink-strong">{user.display_name || user.email}</div><div className="text-xs text-ink-muted">{user.email}</div></td><td className="px-4 py-3 text-ink-muted">{user.organization_count}</td><td className="px-4 py-3"><StatusIndicator label={user.is_platform_admin ? t("platformAdmin.platformAdmin") : t("platformAdmin.standardUser")} tone={user.is_platform_admin ? "primary" : "neutral"} /></td><td className="px-4 py-3"><StatusIndicator label={user.is_active ? t("platformAdmin.active") : t("platformAdmin.suspended")} tone={statusTone(user.is_active)} /></td><td className="px-4 py-3 text-xs text-ink-muted">{date(user.created_at)}</td><td className="px-4 py-3"><div className="flex gap-2"><Button size="sm" variant="outline" loading={actionId === `user-${user.user_id}`} onClick={() => void toggleUser(user)}>{user.is_active ? t("platformAdmin.suspend") : t("platformAdmin.activate")}</Button><Button size="sm" variant="ghost" loading={actionId === `admin-${user.user_id}`} onClick={() => void togglePlatformAdmin(user)}>{user.is_platform_admin ? t("platformAdmin.revokeAdmin") : t("platformAdmin.grantAdmin")}</Button></div></td></tr>)}</tbody></table></div></section></TabPanel>

        <TabPanel value="organizations" className="mt-5"><section className="surface-panel overflow-hidden"><TableHeader title={t("platformAdmin.organizationsTitle")} count={organizations.length} /><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead><tr>{["organization", "members", "knowledge", "models", "status", "actions"].map((key) => <th key={key} className="border-b border-border px-4 py-3 text-start text-xs font-medium text-ink-muted">{t(`platformAdmin.columns.${key}`)}</th>)}</tr></thead><tbody>{organizations.map((organization) => <tr key={organization.id} className="border-b border-border/70 last:border-0 hover:bg-surface-2/70"><td className="px-4 py-3 font-medium text-ink-strong">{organization.name}</td><td className="px-4 py-3 text-ink-muted">{organization.member_count}</td><td className="px-4 py-3 text-ink-muted">{organization.knowledge_base_count}</td><td className="px-4 py-3 text-ink-muted">{organization.model_provider_count}</td><td className="px-4 py-3"><StatusIndicator label={organization.is_active ? t("platformAdmin.active") : t("platformAdmin.suspended")} tone={statusTone(organization.is_active)} /></td><td className="px-4 py-3"><Button size="sm" variant="outline" loading={actionId === `organization-${organization.id}`} onClick={() => void toggleOrganization(organization)}>{organization.is_active ? t("platformAdmin.suspend") : t("platformAdmin.activate")}</Button></td></tr>)}</tbody></table></div></section></TabPanel>

        <TabPanel value="knowledge" className="mt-5"><section className="surface-panel overflow-hidden"><TableHeader title={t("platformAdmin.knowledgeTitle")} count={knowledgeBases.length} /><div className="overflow-x-auto"><table className="w-full min-w-[820px] text-sm"><thead><tr>{["knowledgeBase", "organization", "documents", "chunks", "jobs", "actions"].map((key) => <th key={key} className="border-b border-border px-4 py-3 text-start text-xs font-medium text-ink-muted">{t(`platformAdmin.columns.${key}`)}</th>)}</tr></thead><tbody>{knowledgeBases.map((knowledgeBase) => <tr key={knowledgeBase.id} className="border-b border-border/70 last:border-0 hover:bg-surface-2/70"><td className="px-4 py-3"><div className="font-medium text-ink-strong">{knowledgeBase.name}</div><div className="max-w-[270px] truncate text-xs text-ink-muted">{knowledgeBase.description || "-"}</div></td><td className="px-4 py-3 text-ink-muted">{knowledgeBase.organization_name}</td><td className="px-4 py-3 text-ink-muted">{knowledgeBase.document_count}</td><td className="px-4 py-3 text-ink-muted">{knowledgeBase.chunk_count}</td><td className="px-4 py-3"><StatusIndicator label={t("platformAdmin.failedJobs", { count: knowledgeBase.failed_job_count || 0 })} tone={knowledgeBase.failed_job_count ? "danger" : "success"} /></td><td className="px-4 py-3"><Button size="sm" variant="ghost" loading={actionId === `knowledge-${knowledgeBase.id}`} onClick={() => void removeKnowledgeBase(knowledgeBase)} leftIcon={<Trash2 className="h-3.5 w-3.5" />}>{t("platformAdmin.delete")}</Button></td></tr>)}</tbody></table></div></section></TabPanel>

        <TabPanel value="jobs" className="mt-5"><section className="surface-panel overflow-hidden"><TableHeader title={t("platformAdmin.jobsTitle")} count={jobs.length} /><div className="overflow-x-auto"><table className="w-full min-w-[840px] text-sm"><thead><tr>{["job", "organization", "knowledgeBase", "status", "progress", "updated"].map((key) => <th key={key} className="border-b border-border px-4 py-3 text-start text-xs font-medium text-ink-muted">{t(`platformAdmin.columns.${key}`)}</th>)}</tr></thead><tbody>{jobs.map((job) => <tr key={job.id} className="border-b border-border/70 last:border-0 hover:bg-surface-2/70"><td className="px-4 py-3"><div className="font-medium text-ink-strong">{job.document_title || job.id}</div>{job.error ? <div className="max-w-[260px] truncate text-xs text-danger">{job.error}</div> : null}</td><td className="px-4 py-3 text-ink-muted">{job.organization_name || "-"}</td><td className="px-4 py-3 text-ink-muted">{job.knowledge_base_name || "-"}</td><td className="px-4 py-3"><StatusIndicator label={job.status} tone={statusTone(job.status)} /></td><td className="px-4 py-3"><div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-3"><div className="h-full bg-primary transition-[width] duration-base" style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }} /></div><span className="mt-1 block text-xs text-ink-muted">{job.progress}%</span></td><td className="px-4 py-3 text-xs text-ink-muted">{date(job.updated_at)}</td></tr>)}</tbody></table></div></section></TabPanel>

        <TabPanel value="runtime" className="mt-5"><PlatformRuntimeJobsTable rows={runtimeJobs} date={date} t={t} statusTone={statusTone} /></TabPanel>

        <TabPanel value="artifacts" className="mt-5"><PlatformArtifactsTable rows={artifacts} date={date} t={t} /></TabPanel>

        <TabPanel value="operations" className="mt-5 space-y-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <section className="surface-panel p-4"><div className="flex items-center gap-2"><Database className="h-4 w-4 text-primary" /><h2 className="text-sm font-semibold text-ink-strong">{t("platformAdmin.databaseTitle")}</h2></div><dl className="mt-4 grid gap-3 text-sm"><Metric label={t("platformAdmin.repositoryEngine")} value={operations.database.engine} /><Metric label={t("platformAdmin.runtimeStorage")} value={formatBytes(operations.database.file_bytes)} /><Metric label={t("platformAdmin.databasePages")} value={`${operations.database.page_count.toLocaleString()} / ${operations.database.free_pages.toLocaleString()}`} /><Metric label={t("platformAdmin.databaseJournal")} value={operations.database.journal_mode || "-"} /></dl></section>
            <section className="surface-panel p-4"><div className="flex items-center gap-2"><ServerCog className="h-4 w-4 text-primary" /><h2 className="text-sm font-semibold text-ink-strong">{t("platformAdmin.runtime")}</h2></div><dl className="mt-4 grid gap-3 text-sm"><Metric label={t("platformAdmin.queueBackend")} value={operations.runtime.active || "-"} /><Metric label={t("platformAdmin.queueName")} value={operations.runtime.queue_name || "-"} /><Metric label={t("platformAdmin.runtimeStorage")} value={formatBytes(operations.runtime.durable_job_db_bytes)} /><Metric label={t("platformAdmin.postgresConfigured")} value={operations.runtime.postgres_configured ? t("platformAdmin.active") : t("platformAdmin.unavailable")} /></dl></section>
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <section className="surface-panel p-4"><div className="flex items-center gap-2"><HardDrive className="h-4 w-4 text-primary" /><h2 className="text-sm font-semibold text-ink-strong">{t("platformAdmin.storageTitle")}</h2></div><div className="mt-4 grid gap-3 sm:grid-cols-3"><StorageMetric label={t("platformAdmin.storageUploads")} value={operations.storage.uploads_bytes} /><StorageMetric label={t("platformAdmin.storageRuns")} value={operations.storage.runs_bytes} /><StorageMetric label={t("platformAdmin.storageSessions")} value={operations.storage.sessions_bytes} /></div></section>
            <section className="surface-panel p-4"><div className="flex items-center gap-2"><Wrench className="h-4 w-4 text-primary" /><h2 className="text-sm font-semibold text-ink-strong">{t("platformAdmin.maintenanceTitle")}</h2></div><p className="mt-2 text-sm leading-6 text-ink-muted">{t("platformAdmin.maintenanceDescription")}</p><div className="mt-4 flex flex-wrap gap-2">{(["expire_sessions", "sqlite_checkpoint", "sqlite_vacuum"] as PlatformMaintenanceAction[]).map((action) => <Button key={action} size="sm" variant={action === "sqlite_vacuum" ? "outline" : "secondary"} onClick={() => setMaintenanceAction(action)}>{maintenanceLabel(action)}</Button>)}</div></section>
          </div>
        </TabPanel>

        <TabPanel value="audit" className="mt-5"><section className="surface-panel overflow-hidden"><TableHeader title={t("platformAdmin.auditTitle")} count={auditLogs.length} /><AuditTable rows={auditLogs} date={date} t={t} /></section></TabPanel>
      </Tabs>

      <Dialog
        open={maintenanceAction !== null}
        onOpenChange={(open) => { if (!open) setMaintenanceAction(null); }}
        title={t("platformAdmin.maintenanceConfirmTitle")}
        description={maintenanceAction ? t("platformAdmin.maintenanceConfirmDescription", { action: maintenanceLabel(maintenanceAction) }) : ""}
        closeLabel={t("platformAdmin.close")}
        footer={<><Button variant="ghost" onClick={() => setMaintenanceAction(null)}>{t("platformAdmin.cancel")}</Button><Button variant="primary" loading={Boolean(maintenanceAction && actionId === `maintenance-${maintenanceAction}`)} onClick={() => void runMaintenance()}>{t("platformAdmin.confirm")}</Button></>}
      >
        <p className="text-sm leading-6 text-ink-muted">{t("platformAdmin.maintenanceConfirmBody")}</p>
      </Dialog>
    </div>
  );
}

function PlatformRuntimeJobsTable({
  rows,
  date,
  t,
  statusTone,
}: {
  rows: PlatformRuntimeJob[];
  date: (value?: string | null) => string;
  t: (key: string, options?: Record<string, unknown>) => string;
  statusTone: (status: string | number | boolean) => StatusTone;
}) {
  return (
    <section className="surface-panel overflow-hidden">
      <TableHeader title={t("platformAdmin.runtimeJobsTitle")} count={rows.length} />
      {rows.length === 0 ? <p className="p-4 text-sm text-ink-muted">{t("platformAdmin.emptyRuntimeJobs")}</p> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[920px] text-sm"><thead><tr>{["job", "organization", "type", "status", "progress", "updated"].map((key) => <th key={key} className="border-b border-border px-4 py-3 text-start text-xs font-medium text-ink-muted">{t(`platformAdmin.columns.${key}`)}</th>)}</tr></thead><tbody>{rows.map((job) => <tr key={job.job_id} className="border-b border-border/70 last:border-0 hover:bg-surface-2/70"><td className="px-4 py-3"><div className="max-w-[280px] truncate font-medium text-ink-strong">{job.title}</div><div className="max-w-[280px] truncate font-mono text-xs text-ink-muted">{job.job_id}</div>{job.error ? <div className="max-w-[280px] truncate text-xs text-danger">{job.error}</div> : null}</td><td className="px-4 py-3 text-ink-muted">{job.organization_name || "-"}</td><td className="px-4 py-3 text-ink-muted">{job.kind || "-"}</td><td className="px-4 py-3"><StatusIndicator label={job.status} tone={statusTone(job.status)} /></td><td className="px-4 py-3"><div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-3"><div className="h-full bg-primary transition-[width] duration-base" style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }} /></div><span className="mt-1 block text-xs text-ink-muted">{job.progress}%</span></td><td className="px-4 py-3 text-xs text-ink-muted">{date(job.updated_at)}</td></tr>)}</tbody></table></div>
      )}
    </section>
  );
}

function PlatformArtifactsTable({
  rows,
  date,
  t,
}: {
  rows: PlatformWorkspaceArtifact[];
  date: (value?: string | null) => string;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <section className="surface-panel overflow-hidden">
      <TableHeader title={t("platformAdmin.artifactsTitle")} count={rows.length} />
      {rows.length === 0 ? <p className="p-4 text-sm text-ink-muted">{t("platformAdmin.emptyArtifacts")}</p> : (
        <div className="overflow-x-auto"><table className="w-full min-w-[920px] text-sm"><thead><tr>{["identifier", "type", "organization", "actor", "status", "updated"].map((key) => <th key={key} className="border-b border-border px-4 py-3 text-start text-xs font-medium text-ink-muted">{t(`platformAdmin.columns.${key}`)}</th>)}</tr></thead><tbody>{rows.map((artifact) => <tr key={`${artifact.artifact_type}-${artifact.artifact_id}`} className="border-b border-border/70 last:border-0 hover:bg-surface-2/70"><td className="px-4 py-3"><div className="max-w-[300px] truncate font-mono text-xs text-ink-strong">{artifact.artifact_id}</div><div className="mt-1 max-w-[300px] truncate text-xs text-ink-muted">{artifact.storage_path || artifact.session_id || "-"}</div></td><td className="px-4 py-3 text-ink-muted">{artifact.artifact_type}</td><td className="px-4 py-3 text-ink-muted">{artifact.organization_name || "-"}</td><td className="px-4 py-3 text-ink-muted">{artifact.created_by_email || "-"}</td><td className="px-4 py-3"><StatusIndicator label={artifact.attempt_id ? t("platformAdmin.active") : t("platformAdmin.unavailable")} tone={artifact.attempt_id ? "primary" : "neutral"} /></td><td className="px-4 py-3 text-xs text-ink-muted">{date(artifact.updated_at)}</td></tr>)}</tbody></table></div>
      )}
    </section>
  );
}

function StorageMetric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-md border border-border/80 bg-surface-2/50 p-3"><div className="text-xs text-ink-muted">{label}</div><div className="mt-2 text-lg font-semibold tabular-nums text-ink-strong">{formatBytes(value)}</div></div>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="flex items-center justify-between gap-3 border-b border-border/70 pb-3 last:border-0 last:pb-0"><dt className="text-ink-muted">{label}</dt><dd className="font-medium text-ink-strong">{value}</dd></div>;
}

function TableHeader({ title, count }: { title: string; count: number }) {
  return <div className="flex items-center justify-between border-b border-border px-4 py-3"><h2 className="text-sm font-semibold text-ink-strong">{title}</h2><span className="text-xs text-ink-muted">{count}</span></div>;
}

function AuditTable({ rows, date, t }: { rows: PlatformAuditLog[]; date: (value?: string | null) => string; t: (key: string, options?: Record<string, unknown>) => string }) {
  return <div className="overflow-x-auto"><table className="mt-3 w-full min-w-[720px] text-sm"><thead><tr>{["event", "actor", "organization", "created"].map((key) => <th key={key} className="border-b border-border px-4 py-3 text-start text-xs font-medium text-ink-muted">{t(`platformAdmin.columns.${key}`)}</th>)}</tr></thead><tbody>{rows.map((entry) => <tr key={entry.id} className="border-b border-border/70 last:border-0 hover:bg-surface-2/70"><td className="px-4 py-3 font-medium text-ink-strong">{entry.action}</td><td className="px-4 py-3 text-ink-muted">{entry.actor_email || "-"}</td><td className="px-4 py-3 text-ink-muted">{entry.organization_name || "-"}</td><td className="px-4 py-3 text-xs text-ink-muted">{date(entry.created_at)}</td></tr>)}</tbody></table></div>;
}

function formatBytes(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}
