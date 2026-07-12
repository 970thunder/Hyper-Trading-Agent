import type { FormEvent } from "react";
import { Database, Loader2, RefreshCw, Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type {
  CommercialIngestionJob,
  CommercialKnowledgeBackendStatus,
  CommercialKnowledgeBase,
  CommercialKnowledgeDocument,
  CommercialKnowledgeSearchResult,
  CommercialPrincipal,
  KnowledgeDocument,
  KnowledgeSearchResult,
  KnowledgeStats,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { KnowledgeDocumentTable, KnowledgeSearchResults } from "./KnowledgeFragments";
import { KnowledgeIngestionJobs } from "./KnowledgeIngestionJobs";

const fieldClass =
  "w-full rounded-md border border-border/75 bg-background px-3 py-2 text-sm outline-none transition focus:border-primary/70 focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60";
const labelClass = "text-sm font-medium";
const hintClass = "text-xs text-muted-foreground";
const sectionCardClass = "rounded-lg border border-border/70 bg-card p-5 shadow-sm";

interface KnowledgeSettingsPanelProps {
  principal: CommercialPrincipal | null;
  loadError: string;
  knowledgeStats: KnowledgeStats | null;
  localDocuments: KnowledgeDocument[];
  knowledgeBases: CommercialKnowledgeBase[];
  selectedKnowledgeBaseId: string;
  backendStatus: CommercialKnowledgeBackendStatus | null;
  commercialDocuments: CommercialKnowledgeDocument[];
  ingestionJobs: CommercialIngestionJob[];
  searchResults: Array<CommercialKnowledgeSearchResult | KnowledgeSearchResult>;
  knowledgeTitle: string;
  knowledgePath: string;
  knowledgeUrl: string;
  knowledgeQuery: string;
  hasKnowledgeFile: boolean;
  creatingKnowledgeBase: boolean;
  knowledgeSaving: boolean;
  knowledgeSearching: boolean;
  knowledgeJobAction: string | null;
  onRefresh: () => Promise<void> | void;
  onCreateDefaultKnowledgeBase: () => Promise<void> | void;
  onKnowledgeBaseChange: (knowledgeBaseId: string) => Promise<void> | void;
  onTitleChange: (value: string) => void;
  onPathChange: (value: string) => void;
  onUrlChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  onFileChange: (file: File | null) => void;
  onSubmitKnowledge: (event: FormEvent<HTMLFormElement>) => void;
  onSubmitSearch: (event: FormEvent<HTMLFormElement>) => void;
  onReindexDocument: (documentId: string) => void;
  onRetryJob: (jobId: string) => void;
  onCancelJob: (jobId: string) => void;
}

export function KnowledgeSettingsPanel({
  principal,
  loadError,
  knowledgeStats,
  localDocuments,
  knowledgeBases,
  selectedKnowledgeBaseId,
  backendStatus,
  commercialDocuments,
  ingestionJobs,
  searchResults,
  knowledgeTitle,
  knowledgePath,
  knowledgeUrl,
  knowledgeQuery,
  hasKnowledgeFile,
  creatingKnowledgeBase,
  knowledgeSaving,
  knowledgeSearching,
  knowledgeJobAction,
  onRefresh,
  onCreateDefaultKnowledgeBase,
  onKnowledgeBaseChange,
  onTitleChange,
  onPathChange,
  onUrlChange,
  onQueryChange,
  onFileChange,
  onSubmitKnowledge,
  onSubmitSearch,
  onReindexDocument,
  onRetryJob,
  onCancelJob,
}: KnowledgeSettingsPanelProps) {
  const { t } = useTranslation();

  const refresh = () => {
    Promise.resolve(onRefresh()).catch((error) => {
      toast.error(t("settings.knowledge.refreshFailed", { message: error instanceof Error ? error.message : t("settings.unknownError") }));
    });
  };

  const changeKnowledgeBase = (knowledgeBaseId: string) => {
    Promise.resolve(onKnowledgeBaseChange(knowledgeBaseId)).catch((error) => {
      toast.error(t("settings.knowledge.refreshFailed", { message: error instanceof Error ? error.message : t("settings.unknownError") }));
    });
  };

  return (
    <section className={sectionCardClass}>
      <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">{t("settings.knowledge.title")}</h2>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">{t("settings.knowledge.description")}</p>
        </div>
        <button type="button" onClick={refresh} className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground">
          <RefreshCw className="h-4 w-4" />
          {t("settings.refresh")}
        </button>
      </div>

      {principal ? (
        <>
          <div className="mb-5 grid gap-3 md:grid-cols-5">
            <MetricCard label={t("settings.knowledge.mode")} value={t("settings.knowledge.commercialMode")} />
            <MetricCard label={t("settings.knowledge.knowledgeBases")} value={String(knowledgeBases.length)} />
            <MetricCard label={t("settings.knowledge.documents")} value={String(commercialDocuments.length)} />
            <MetricCard label={t("settings.knowledge.retrieval")} value={t("settings.knowledge.hybridRetrieval")} />
            <MetricCard
              label={t("settings.knowledge.embedding")}
              value={backendStatus?.primary.available ? backendStatus.primary.provider : t("settings.knowledge.localFallback")}
              title={backendStatus?.primary.available ? backendStatus.primary.model : backendStatus?.fallback.model}
            />
          </div>

          {knowledgeBases.length ? (
            <div className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
              <label className="grid gap-2">
                <span className={labelClass}>{t("settings.knowledge.selectKb")}</span>
                <select value={selectedKnowledgeBaseId} onChange={(event) => changeKnowledgeBase(event.target.value)} className={fieldClass}>
                  {knowledgeBases.map((kb) => (
                    <option key={kb.id} value={kb.id}>{kb.name}</option>
                  ))}
                </select>
              </label>
              <div className="grid gap-2 rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
                <span>{t("settings.knowledge.pipelineDescription")}</span>
                {backendStatus ? (
                  <span>
                    {backendStatus.primary.available
                      ? t("settings.knowledge.embeddingProviderReady", {
                        provider: backendStatus.primary.provider,
                        model: backendStatus.primary.model,
                      })
                      : t("settings.knowledge.embeddingFallbackActive", {
                        provider: backendStatus.primary.provider,
                        model: backendStatus.fallback.model,
                      })}
                  </span>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="mb-5 rounded-md border bg-muted/20 p-4">
              <p className="text-sm text-muted-foreground">{t("settings.knowledge.noKnowledgeBaseHint")}</p>
              <button type="button" onClick={onCreateDefaultKnowledgeBase} disabled={creatingKnowledgeBase} className="mt-3 inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
                {creatingKnowledgeBase ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                {t("settings.knowledge.createDefaultKb")}
              </button>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <form onSubmit={onSubmitKnowledge} className="grid gap-4 rounded-md border bg-muted/10 p-4">
              <TextField label={t("settings.knowledge.documentTitle")} value={knowledgeTitle} onChange={onTitleChange} placeholder={t("settings.optional")} />
              <label className="grid gap-2">
                <span className={labelClass}>{t("settings.knowledge.uploadFile")}</span>
                <input
                  type="file"
                  onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
                  className={fieldClass}
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.md,.txt,.html,.htm,.csv,.tsv,.json,.yaml,.yml"
                />
                <span className={hintClass}>{t("settings.knowledge.fileTypes")}</span>
              </label>
              <TextField label={t("settings.knowledge.documentPath")} value={knowledgePath} onChange={onPathChange} placeholder="uploads/research-notes.md" />
              <TextField label={t("settings.knowledge.url")} value={knowledgeUrl} onChange={onUrlChange} placeholder="https://example.com/research.html" />
              <PrimaryButton type="submit" disabled={knowledgeSaving || !selectedKnowledgeBaseId || (!hasKnowledgeFile && !knowledgePath.trim() && !knowledgeUrl.trim())} loading={knowledgeSaving} label={t("settings.knowledge.index")} />
            </form>

            <div className="rounded-md border bg-muted/10 p-4">
              <form onSubmit={onSubmitSearch} className="grid gap-3">
                <TextField label={t("settings.knowledge.searchTest")} value={knowledgeQuery} onChange={onQueryChange} placeholder={t("settings.knowledge.searchPlaceholder")} />
                <PrimaryButton type="submit" disabled={knowledgeSearching || !knowledgeQuery.trim() || !selectedKnowledgeBaseId} loading={knowledgeSearching} label={t("settings.knowledge.search")} />
              </form>
              <KnowledgeSearchResults results={searchResults} emptyLabel={t("settings.knowledge.noSearchResults")} />
            </div>
          </div>

          <KnowledgeIngestionJobs
            jobs={ingestionJobs}
            actionBusyId={knowledgeJobAction}
            onRetry={onRetryJob}
            onCancel={onCancelJob}
          />

          {commercialDocuments.length ? (
            <KnowledgeDocumentTable
              rows={commercialDocuments.map((doc) => ({
                id: doc.id,
                title: doc.title,
                chunkCount: doc.chunk_count,
                source: doc.source_uri,
                status: doc.status,
                ingestionStatus: doc.ingestion_status || "",
                ingestionProgress: Number(doc.ingestion_progress || 0),
                ingestionError: doc.ingestion_error || "",
              }))}
              titleLabel={t("settings.knowledge.documentTitle")}
              chunksLabel={t("settings.knowledge.chunks")}
              sourceLabel={t("settings.knowledge.source")}
              statusLabel={t("settings.status")}
              actionsLabel={t("settings.swarmAgents.actions")}
              reindexLabel={t("settings.knowledge.reindex")}
              loadingLabel={t("settings.loading")}
              actionBusyId={knowledgeJobAction}
              onReindex={onReindexDocument}
            />
          ) : (
            <EmptyKnowledge label={t("settings.knowledge.empty")} />
          )}
        </>
      ) : knowledgeStats ? (
        <>
          <div className="mb-5 grid gap-3 md:grid-cols-3">
            <MetricCard label={t("settings.knowledge.documents")} value={String(knowledgeStats.document_count)} />
            <MetricCard label={t("settings.knowledge.chunks")} value={String(knowledgeStats.chunk_count)} />
            <MetricCard label={t("settings.knowledge.storage")} value={knowledgeStats.db_path} title={knowledgeStats.db_path} />
          </div>
          <form onSubmit={onSubmitKnowledge} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.45fr)_auto]">
            <TextField label={t("settings.knowledge.documentPath")} value={knowledgePath} onChange={onPathChange} placeholder="uploads/research-notes.md" />
            <TextField label={t("settings.knowledge.documentTitle")} value={knowledgeTitle} onChange={onTitleChange} placeholder={t("settings.optional")} />
            <PrimaryButton type="submit" disabled={knowledgeSaving || !knowledgePath.trim()} loading={knowledgeSaving} label={t("settings.knowledge.index")} className="self-end" />
          </form>
          <form onSubmit={onSubmitSearch} className="mt-5 grid gap-4 rounded-md border bg-muted/10 p-4 lg:grid-cols-[minmax(0,1fr)_auto]">
            <TextField label={t("settings.knowledge.searchTest")} value={knowledgeQuery} onChange={onQueryChange} placeholder={t("settings.knowledge.searchPlaceholder")} />
            <PrimaryButton type="submit" disabled={knowledgeSearching || !knowledgeQuery.trim()} loading={knowledgeSearching} label={t("settings.knowledge.search")} className="self-end" />
          </form>
          <KnowledgeSearchResults results={searchResults} emptyLabel={t("settings.knowledge.noSearchResults")} />
          {localDocuments.length ? (
            <KnowledgeDocumentTable
              rows={localDocuments.slice(0, 8).map((doc) => ({
                id: doc.id,
                title: doc.title,
                chunkCount: doc.chunk_count,
                source: doc.source_path,
                status: t("settings.knowledge.ready"),
              }))}
              titleLabel={t("settings.knowledge.documentTitle")}
              chunksLabel={t("settings.knowledge.chunks")}
              sourceLabel={t("settings.knowledge.source")}
              statusLabel={t("settings.status")}
            />
          ) : (
            <EmptyKnowledge label={t("settings.knowledge.empty")} />
          )}
        </>
      ) : (
        <EmptyKnowledge label={loadError || t("settings.unavailable")} />
      )}
    </section>
  );
}

function MetricCard({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="rounded-md border bg-muted/20 p-4">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="mt-2 truncate text-lg font-semibold" title={title ?? value}>{value}</div>
    </div>
  );
}

function EmptyKnowledge({ label }: { label: string }) {
  return (
    <div className="mt-5 rounded-md border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="grid gap-2">
      <span className={labelClass}>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} className={fieldClass} placeholder={placeholder} autoComplete={type === "password" ? "current-password" : undefined} />
    </label>
  );
}

function PrimaryButton({
  type = "button",
  disabled,
  loading,
  label,
  className,
}: {
  type?: "button" | "submit";
  disabled?: boolean;
  loading?: boolean;
  label: string;
  className?: string;
}) {
  return (
    <button type={type} disabled={disabled} className={cn("inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70", className)}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
      {label}
    </button>
  );
}
