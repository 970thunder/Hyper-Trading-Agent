import { useId, useState, type FormEvent } from "react";
import { Database, FilePlus2, Plus, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  CommercialIngestionJob,
  CommercialKnowledgeBackendStatus,
  CommercialKnowledgeBase,
  CommercialKnowledgeBaseAccess,
  CommercialKnowledgeBaseConfig,
  CommercialKnowledgeDocument,
  CommercialKnowledgeSearchResult,
  CommercialPrincipal,
} from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { StatusIndicator } from "@/components/ui/Status";
import { Tab, TabList, TabPanel, Tabs } from "@/components/ui/Tabs";
import { KnowledgeBaseList } from "./KnowledgeBaseList";
import { DocumentsTable } from "./DocumentsTable";
import { IngestionJobs } from "./IngestionJobs";
import { SearchEvaluation } from "./SearchEvaluation";
import { EvaluationDatasets } from "./EvaluationDatasets";
import { KnowledgeConfiguration } from "./KnowledgeConfiguration";
import { KnowledgeAccess } from "./KnowledgeAccess";

export type KnowledgeWorkspaceTab = "documents" | "jobs" | "search" | "evaluation" | "configuration" | "access";

interface KnowledgeWorkspaceProps {
  principal: CommercialPrincipal;
  knowledgeBases: CommercialKnowledgeBase[];
  selectedId: string;
  backendStatus: CommercialKnowledgeBackendStatus | null;
  documents: CommercialKnowledgeDocument[];
  jobs: CommercialIngestionJob[];
  searchQuery: string;
  searchResults: CommercialKnowledgeSearchResult[];
  searching: boolean;
  actionId: string | null;
  configurationSaving: boolean;
  accessSaving: boolean;
  creating: boolean;
  onSelectKnowledgeBase: (knowledgeBaseId: string) => void;
  onRefresh: () => void;
  onOpenImport: () => void;
  onCreateKnowledgeBase: (name: string, description: string) => Promise<void> | void;
  onOpenDocument: (document: CommercialKnowledgeDocument) => void;
  onReindexDocument: (document: CommercialKnowledgeDocument) => void;
  onDeleteDocument: (document: CommercialKnowledgeDocument) => void;
  onRetryJob: (job: CommercialIngestionJob) => void;
  onCancelJob: (job: CommercialIngestionJob) => void;
  onSearchQueryChange: (query: string) => void;
  onSearch: () => void;
  onSaveConfiguration: (config: CommercialKnowledgeBaseConfig) => Promise<void> | void;
  onSaveAccess: (access: CommercialKnowledgeBaseAccess) => Promise<void> | void;
}

const FALLBACK_CONFIG: CommercialKnowledgeBaseConfig = {
  chunk_size: 1400,
  chunk_overlap: 180,
  retrieval_mode: "hybrid",
  top_k: 8,
};

const FALLBACK_ACCESS: CommercialKnowledgeBaseAccess = {
  read_roles: ["owner", "admin", "member", "viewer"],
  write_roles: ["owner", "admin", "member"],
};

export function KnowledgeWorkspace({
  principal,
  knowledgeBases,
  selectedId,
  backendStatus,
  documents,
  jobs,
  searchQuery,
  searchResults,
  searching,
  actionId,
  configurationSaving,
  accessSaving,
  creating,
  onSelectKnowledgeBase,
  onRefresh,
  onOpenImport,
  onCreateKnowledgeBase,
  onOpenDocument,
  onReindexDocument,
  onDeleteDocument,
  onRetryJob,
  onCancelJob,
  onSearchQueryChange,
  onSearch,
  onSaveConfiguration,
  onSaveAccess,
}: KnowledgeWorkspaceProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<KnowledgeWorkspaceTab>("documents");
  const [createOpen, setCreateOpen] = useState(false);
  const selected = knowledgeBases.find((knowledgeBase) => knowledgeBase.id === selectedId) || null;
  const canWrite = selected ? selected.access?.write_roles?.includes(principal.role) ?? principal.role !== "viewer" : principal.role !== "viewer";
  const canManage = principal.role === "owner" || principal.role === "admin";
  const config = selected?.config || FALLBACK_CONFIG;
  const access = selected?.access || FALLBACK_ACCESS;
  const activeJobs = jobs.filter((job) => ["pending", "running"].includes(job.status.toLowerCase())).length;
  const failedJobs = jobs.filter((job) => ["failed", "error"].includes(job.status.toLowerCase())).length;

  return (
    <div data-page-enter className="mx-auto flex min-h-[calc(100dvh-3.5rem)] w-full max-w-[1600px] flex-col px-3 py-3 sm:px-4 sm:py-4 lg:px-5">
      <header className="mb-4 flex flex-col gap-4 border-b border-[hsl(var(--border-subtle))] pb-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-medium text-primary">
            <Database className="h-4 w-4" aria-hidden="true" />
            {t("knowledgeWorkspace.productLabel")}
          </div>
          <h1 className="mt-1.5 text-2xl font-semibold leading-8 text-ink-strong">{t("knowledgeWorkspace.title")}</h1>
          <p className="mt-1 max-w-3xl text-sm leading-5 text-ink-muted">{t("knowledgeWorkspace.description")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {backendStatus ? (
            <StatusIndicator
              tone={backendStatus.primary.available ? "success" : "warning"}
              label={backendStatus.primary.available ? `${backendStatus.primary.provider} / ${backendStatus.primary.model}` : backendStatus.fallback.model}
              dot
            />
          ) : null}
          <Button variant="ghost" leftIcon={<RefreshCw className="h-4 w-4" />} onClick={onRefresh}>
            {t("knowledgeWorkspace.refresh")}
          </Button>
          {canWrite && selected ? (
            <Button variant="primary" leftIcon={<FilePlus2 className="h-4 w-4" />} onClick={onOpenImport}>
              {t("knowledgeWorkspace.importDocument")}
            </Button>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-surface-1 shadow-xs lg:flex">
        <KnowledgeBaseList
          knowledgeBases={knowledgeBases}
          selectedId={selectedId}
          selectedDocumentCount={documents.length}
          canCreate={canManage}
          onSelect={(id) => {
            setTab("documents");
            onSelectKnowledgeBase(id);
          }}
          onCreate={() => setCreateOpen(true)}
        />

        <main className="min-w-0 flex-1">
          {selected ? (
            <Tabs value={tab} onValueChange={(value) => setTab(value as KnowledgeWorkspaceTab)}>
              <div className="flex flex-col gap-3 border-b border-[hsl(var(--border-subtle))] px-3 py-3 md:flex-row md:items-end md:justify-between md:px-4">
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold text-ink-strong">{selected.name}</h2>
                  <p className="mt-0.5 truncate text-xs text-ink-muted">{selected.description || t("knowledgeWorkspace.noDescription")}</p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-ink-muted">
                  <span>{t("knowledgeWorkspace.documentCount", { count: documents.length })}</span>
                  <span>{t("knowledgeWorkspace.activeJobCount", { count: activeJobs })}</span>
                  {failedJobs ? <span className="text-danger">{t("knowledgeWorkspace.failedJobCount", { count: failedJobs })}</span> : null}
                </div>
              </div>
              <TabList className="mx-3 mt-3 border-0 border-b border-[hsl(var(--border-subtle))] bg-transparent p-0 md:mx-4">
                <Tab value="documents">{t("knowledgeWorkspace.tabs.documents")}</Tab>
                <Tab value="jobs">{t("knowledgeWorkspace.tabs.jobs")}</Tab>
                <Tab value="search">{t("knowledgeWorkspace.tabs.search")}</Tab>
                <Tab value="evaluation">{t("knowledgeWorkspace.tabs.evaluation")}</Tab>
                <Tab value="configuration" disabled={!canManage}>{t("knowledgeWorkspace.tabs.configuration")}</Tab>
                <Tab value="access" disabled={!canManage}>{t("knowledgeWorkspace.tabs.access")}</Tab>
              </TabList>
              <TabPanel value="documents" className="mt-3">
                <DocumentsTable
                  documents={documents}
                  canWrite={canManage}
                  actionId={actionId}
                  onOpen={onOpenDocument}
                  onReindex={onReindexDocument}
                  onDelete={onDeleteDocument}
                />
              </TabPanel>
              <TabPanel value="jobs" className="mt-3">
                <IngestionJobs jobs={jobs} documents={documents} canWrite={canManage} actionId={actionId} onRetry={onRetryJob} onCancel={onCancelJob} />
              </TabPanel>
              <TabPanel value="search" className="mt-3">
                <SearchEvaluation
                  config={config}
                  query={searchQuery}
                  searching={searching}
                  results={searchResults}
                  onQueryChange={onSearchQueryChange}
                  onSearch={onSearch}
                />
              </TabPanel>
              <TabPanel value="evaluation" className="mt-3">
                <EvaluationDatasets
                  knowledgeBaseId={selected.id}
                  documents={documents}
                  config={config}
                  canManage={canManage}
                />
              </TabPanel>
              <TabPanel value="configuration" className="mt-3">
                {canManage ? <KnowledgeConfiguration config={config} backendStatus={backendStatus} saving={configurationSaving} onSave={onSaveConfiguration} /> : null}
              </TabPanel>
              <TabPanel value="access" className="mt-3">
                {canManage ? <KnowledgeAccess access={access} saving={accessSaving} onSave={onSaveAccess} /> : null}
              </TabPanel>
            </Tabs>
          ) : (
            <div className="flex min-h-[420px] flex-col items-center justify-center px-6 text-center">
              <Database className="h-8 w-8 text-ink-disabled" aria-hidden="true" />
              <h2 className="mt-3 text-base font-semibold text-ink-strong">{t("knowledgeWorkspace.noBase")}</h2>
              <p className="mt-1 max-w-md text-sm text-ink-muted">{t("knowledgeWorkspace.noBaseDescription")}</p>
              {canManage ? (
                <Button className="mt-4" variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>
                  {t("knowledgeWorkspace.createBase")}
                </Button>
              ) : null}
            </div>
          )}
        </main>
      </div>

      <CreateKnowledgeBaseDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        creating={creating}
        onCreate={onCreateKnowledgeBase}
      />
    </div>
  );
}

function CreateKnowledgeBaseDialog({
  open,
  onOpenChange,
  creating,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  creating: boolean;
  onCreate: (name: string, description: string) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const formId = `create-kb-${useId().replace(/:/g, "")}`;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) return;
    await onCreate(name.trim(), description.trim());
    setName("");
    setDescription("");
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("knowledgeWorkspace.createBase")}
      description={t("knowledgeWorkspace.createBaseDescription")}
      closeLabel={t("knowledgeWorkspace.close")}
      className="w-[min(34rem,calc(100vw-2rem))]"
      footer={(
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t("knowledgeWorkspace.cancel")}</Button>
          <Button type="submit" form={formId} variant="primary" loading={creating} disabled={!name.trim()}>{t("knowledgeWorkspace.create")}</Button>
        </>
      )}
    >
      <form id={formId} onSubmit={(event) => void submit(event)} className="grid gap-4">
        <Field label={t("knowledgeWorkspace.baseName")} required>
          <Input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </Field>
        <Field label={t("knowledgeWorkspace.baseDescription")}>
          <Textarea value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}
