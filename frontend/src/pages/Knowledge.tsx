import { useCallback, useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  api,
  type CommercialIngestionJob,
  type CommercialKnowledgeBase,
  type CommercialKnowledgeBaseAccess,
  type CommercialKnowledgeBaseConfig,
  type CommercialKnowledgeBackendStatus,
  type CommercialKnowledgeChunk,
  type CommercialKnowledgeDocument,
  type CommercialKnowledgeDocumentDetail,
  type CommercialKnowledgeSearchResult,
  type CommercialPrincipal,
} from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { InlineError, Skeleton } from "@/components/ui/AsyncState";
import { DocumentDrawer } from "@/pages/knowledge/DocumentDrawer";
import { ImportDialog, type KnowledgeImportRequest } from "@/pages/knowledge/ImportDialog";
import { KnowledgeWorkspace } from "@/pages/knowledge/KnowledgeWorkspace";

export function Knowledge() {
  const { t } = useTranslation();
  const [principal, setPrincipal] = useState<CommercialPrincipal | null>(null);
  const [knowledgeBases, setKnowledgeBases] = useState<CommercialKnowledgeBase[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [backendStatus, setBackendStatus] = useState<CommercialKnowledgeBackendStatus | null>(null);
  const [documents, setDocuments] = useState<CommercialKnowledgeDocument[]>([]);
  const [jobs, setJobs] = useState<CommercialIngestionJob[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CommercialKnowledgeSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [searching, setSearching] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [configurationSaving, setConfigurationSaving] = useState(false);
  const [accessSaving, setAccessSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importSaving, setImportSaving] = useState(false);
  const [drawerDocument, setDrawerDocument] = useState<CommercialKnowledgeDocument | null>(null);
  const [drawerDetail, setDrawerDetail] = useState<CommercialKnowledgeDocumentDetail | null>(null);
  const [drawerChunks, setDrawerChunks] = useState<CommercialKnowledgeChunk[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerError, setDrawerError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<CommercialKnowledgeDocument | null>(null);

  const selectedKnowledgeBase = useMemo(
    () => knowledgeBases.find((knowledgeBase) => knowledgeBase.id === selectedId) || null,
    [knowledgeBases, selectedId],
  );

  const loadKnowledgeBaseData = useCallback(async (knowledgeBaseId: string) => {
    if (!knowledgeBaseId) {
      setDocuments([]);
      setJobs([]);
      return;
    }
    const [nextDocuments, nextJobs] = await Promise.all([
      api.listCommercialKnowledgeDocuments(knowledgeBaseId),
      api.listCommercialIngestionJobs(knowledgeBaseId, 100),
    ]);
    setDocuments(nextDocuments);
    setJobs(nextJobs);
  }, []);

  const loadWorkspace = useCallback(async (preferredId: string) => {
    setLoadError("");
    const [me, bases, status] = await Promise.all([
      api.getCommercialMe(),
      api.listKnowledgeBases(),
      api.getCommercialKnowledgeBackendStatus().catch(() => null),
    ]);
    setPrincipal(me);
    setKnowledgeBases(bases);
    setBackendStatus(status);
    const nextId = preferredId && bases.some((knowledgeBase) => knowledgeBase.id === preferredId)
      ? preferredId
      : bases[0]?.id || "";
    setSelectedId(nextId);
    await loadKnowledgeBaseData(nextId);
  }, [loadKnowledgeBaseData]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loadWorkspace("")
      .catch((error) => {
        if (alive) setLoadError(error instanceof Error ? error.message : t("knowledgeWorkspace.loadFailed"));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [loadWorkspace, t]);

  const hasActiveJobs = jobs.some((job) => ["pending", "running"].includes(job.status.toLowerCase()));
  useEffect(() => {
    if (!selectedId || !hasActiveJobs) return;
    const timer = window.setInterval(() => {
      void loadKnowledgeBaseData(selectedId).catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [hasActiveJobs, loadKnowledgeBaseData, selectedId]);

  const selectKnowledgeBase = async (knowledgeBaseId: string) => {
    setSelectedId(knowledgeBaseId);
    setSearchResults([]);
    try {
      await loadKnowledgeBaseData(knowledgeBaseId);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const refresh = async () => {
    try {
      await loadWorkspace(selectedId);
      toast.success(t("knowledgeWorkspace.refreshed"));
    } catch (error) {
      const message = errorMessage(error);
      setLoadError(message);
      toast.error(message);
    }
  };

  const createKnowledgeBase = async (name: string, description: string) => {
    setCreating(true);
    try {
      const created = await api.createKnowledgeBase({ name, description });
      await loadWorkspace(created.id);
      toast.success(t("knowledgeWorkspace.baseCreated"));
    } catch (error) {
      toast.error(errorMessage(error));
      throw error;
    } finally {
      setCreating(false);
    }
  };

  const importDocument = async (request: KnowledgeImportRequest) => {
    if (!selectedId) return;
    setImportSaving(true);
    try {
      if (request.mode === "file" && request.file) {
        const uploaded = await api.uploadFile(request.file);
        await api.addCommercialKnowledgeDocument(selectedId, {
          path: uploaded.file_path,
          title: request.title || request.file.name,
          chunk_size: request.chunk_size,
          chunk_overlap: request.chunk_overlap,
        });
      } else if (request.mode === "url" && request.url) {
        await api.addCommercialKnowledgeUrl(selectedId, {
          url: request.url,
          title: request.title || undefined,
          chunk_size: request.chunk_size,
          chunk_overlap: request.chunk_overlap,
        });
      } else if (request.mode === "path" && request.path) {
        await api.addCommercialKnowledgeDocument(selectedId, {
          path: request.path,
          title: request.title || undefined,
          chunk_size: request.chunk_size,
          chunk_overlap: request.chunk_overlap,
        });
      }
      await loadKnowledgeBaseData(selectedId);
      toast.success(t("knowledgeWorkspace.importQueued"));
    } catch (error) {
      toast.error(errorMessage(error));
      throw error;
    } finally {
      setImportSaving(false);
    }
  };

  const openDocument = async (document: CommercialKnowledgeDocument) => {
    if (!selectedId) return;
    setDrawerDocument(document);
    setDrawerDetail(null);
    setDrawerChunks([]);
    setDrawerError("");
    setDrawerLoading(true);
    try {
      const [detail, chunkList] = await Promise.all([
        api.getCommercialKnowledgeDocumentDetail(selectedId, document.id),
        api.listCommercialKnowledgeDocumentChunks(selectedId, document.id),
      ]);
      setDrawerDetail(detail);
      setDrawerChunks(chunkList.items);
    } catch (error) {
      setDrawerError(errorMessage(error));
    } finally {
      setDrawerLoading(false);
    }
  };

  const reindexDocument = async (document: CommercialKnowledgeDocument) => {
    if (!selectedId) return;
    setActionId(`reindex:${document.id}`);
    try {
      await api.reindexCommercialKnowledgeDocument(selectedId, document.id);
      await loadKnowledgeBaseData(selectedId);
      toast.success(t("knowledgeWorkspace.reindexQueued"));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setActionId(null);
    }
  };

  const retryJob = async (job: CommercialIngestionJob) => {
    if (!selectedId) return;
    setActionId(`retry:${job.id}`);
    try {
      await api.retryCommercialIngestionJob(selectedId, job.id);
      await loadKnowledgeBaseData(selectedId);
      toast.success(t("knowledgeWorkspace.retryQueued"));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setActionId(null);
    }
  };

  const cancelJob = async (job: CommercialIngestionJob) => {
    if (!selectedId) return;
    setActionId(`cancel:${job.id}`);
    try {
      await api.cancelCommercialIngestionJob(selectedId, job.id);
      await loadKnowledgeBaseData(selectedId);
      toast.success(t("knowledgeWorkspace.jobCancelled"));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setActionId(null);
    }
  };

  const deleteDocument = async () => {
    if (!selectedId || !deleteTarget) return;
    const target = deleteTarget;
    setActionId(`delete:${target.id}`);
    try {
      await api.deleteCommercialKnowledgeDocument(selectedId, target.id);
      setDeleteTarget(null);
      await loadKnowledgeBaseData(selectedId);
      toast.success(t("knowledgeWorkspace.documentDeleted"));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setActionId(null);
    }
  };

  const search = async () => {
    if (!selectedId || !searchQuery.trim()) return;
    setSearching(true);
    try {
      const response = await api.searchCommercialKnowledge(selectedId, {
        query: searchQuery.trim(),
        limit: selectedKnowledgeBase?.config?.top_k || 8,
      });
      setSearchResults(response.results);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSearching(false);
    }
  };

  const updateSelectedKnowledgeBase = (updated: CommercialKnowledgeBase) => {
    setKnowledgeBases((current) => current.map((item) => (item.id === updated.id ? updated : item)));
  };

  const saveConfiguration = async (config: CommercialKnowledgeBaseConfig) => {
    if (!selectedId) return;
    setConfigurationSaving(true);
    try {
      updateSelectedKnowledgeBase(await api.updateKnowledgeBase(selectedId, { config }));
      toast.success(t("knowledgeWorkspace.configurationSaved"));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setConfigurationSaving(false);
    }
  };

  const saveAccess = async (access: CommercialKnowledgeBaseAccess) => {
    if (!selectedId) return;
    setAccessSaving(true);
    try {
      updateSelectedKnowledgeBase(await api.updateKnowledgeBase(selectedId, { access }));
      toast.success(t("knowledgeWorkspace.accessSaved"));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setAccessSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto grid min-h-[calc(100dvh-3.5rem)] max-w-[1600px] gap-4 p-5">
        <Skeleton className="h-24" />
        <Skeleton className="min-h-[520px]" />
      </div>
    );
  }

  if (loadError || !principal) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <InlineError
          title={t("knowledgeWorkspace.loadFailed")}
          message={loadError}
          retryLabel={t("knowledgeWorkspace.retry")}
          onRetry={() => void refresh()}
        />
      </div>
    );
  }

  const config = selectedKnowledgeBase?.config || {
    chunk_size: 1400,
    chunk_overlap: 180,
    retrieval_mode: "hybrid" as const,
    top_k: 8,
  };

  return (
    <>
      <KnowledgeWorkspace
        principal={principal}
        knowledgeBases={knowledgeBases}
        selectedId={selectedId}
        backendStatus={backendStatus}
        documents={documents}
        jobs={jobs}
        searchQuery={searchQuery}
        searchResults={searchResults}
        searching={searching}
        actionId={actionId}
        configurationSaving={configurationSaving}
        accessSaving={accessSaving}
        creating={creating}
        onSelectKnowledgeBase={(id) => void selectKnowledgeBase(id)}
        onRefresh={() => void refresh()}
        onOpenImport={() => setImportOpen(true)}
        onCreateKnowledgeBase={createKnowledgeBase}
        onOpenDocument={(document) => void openDocument(document)}
        onReindexDocument={(document) => void reindexDocument(document)}
        onDeleteDocument={setDeleteTarget}
        onRetryJob={(job) => void retryJob(job)}
        onCancelJob={(job) => void cancelJob(job)}
        onSearchQueryChange={setSearchQuery}
        onSearch={() => void search()}
        onSaveConfiguration={saveConfiguration}
        onSaveAccess={saveAccess}
      />

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        config={config}
        saving={importSaving}
        allowGovernedSources={principal.role === "owner" || principal.role === "admin"}
        onImport={importDocument}
      />

      <DocumentDrawer
        open={Boolean(drawerDocument)}
        onOpenChange={(open) => {
          if (!open) setDrawerDocument(null);
        }}
        document={drawerDocument}
        detail={drawerDetail}
        chunks={drawerChunks}
        loading={drawerLoading}
        error={drawerError}
      />

      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={t("knowledgeWorkspace.deleteTitle")}
        description={t("knowledgeWorkspace.deleteDescription", { title: deleteTarget?.title || "" })}
        closeLabel={t("knowledgeWorkspace.close")}
        className="w-[min(30rem,calc(100vw-2rem))]"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>{t("knowledgeWorkspace.cancel")}</Button>
            <Button
              variant="destructive"
              loading={Boolean(deleteTarget && actionId === `delete:${deleteTarget.id}`)}
              leftIcon={<Trash2 className="h-4 w-4" />}
              onClick={() => void deleteDocument()}
            >
              {t("knowledgeWorkspace.delete")}
            </Button>
          </>
        )}
      >
        <p className="text-sm leading-6 text-ink">{t("knowledgeWorkspace.deleteWarning")}</p>
      </Dialog>
    </>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}
