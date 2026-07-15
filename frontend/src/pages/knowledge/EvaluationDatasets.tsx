import { FormEvent, useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Play, Plus, Target, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  api,
  type CommercialKnowledgeBaseConfig,
  type CommercialKnowledgeDocument,
  type CommercialKnowledgeEvaluationCase,
  type CommercialKnowledgeEvaluationDataset,
  type CommercialKnowledgeEvaluationRun,
} from "@/lib/api";
import { Button, IconButton } from "@/components/ui/Button";
import { EmptyState, InlineError, RefreshingOverlay } from "@/components/ui/AsyncState";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input } from "@/components/ui/Field";
import { Metric, Panel, SectionHeader } from "@/components/ui/Panel";
import { Select } from "@/components/ui/Select";
import { StatusIndicator } from "@/components/ui/Status";

interface EvaluationDatasetsProps {
  knowledgeBaseId: string;
  documents: CommercialKnowledgeDocument[];
  config: CommercialKnowledgeBaseConfig;
  canManage: boolean;
}

export function EvaluationDatasets({ knowledgeBaseId, documents, config, canManage }: EvaluationDatasetsProps) {
  const { t, i18n } = useTranslation();
  const [datasets, setDatasets] = useState<CommercialKnowledgeEvaluationDataset[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [cases, setCases] = useState<CommercialKnowledgeEvaluationCase[]>([]);
  const [runs, setRuns] = useState<CommercialKnowledgeEvaluationRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [datasetName, setDatasetName] = useState("");
  const [datasetDescription, setDatasetDescription] = useState("");
  const [caseQuery, setCaseQuery] = useState("");
  const [expectedDocumentId, setExpectedDocumentId] = useState("");
  const [deleteDataset, setDeleteDataset] = useState<CommercialKnowledgeEvaluationDataset | null>(null);
  const [deleteCase, setDeleteCase] = useState<CommercialKnowledgeEvaluationCase | null>(null);

  const selectedDataset = datasets.find((dataset) => dataset.id === selectedDatasetId) || null;
  const documentOptions = useMemo(
    () => documents.map((document) => ({
      value: document.id,
      label: document.title,
      description: t("knowledgeWorkspace.evaluation.documentChunks", { count: document.chunk_count }),
      disabled: document.status !== "ready" && document.status !== "completed",
    })),
    [documents, t],
  );

  const loadDatasetDetail = async (datasetId: string) => {
    if (!datasetId) {
      setCases([]);
      setRuns([]);
      return;
    }
    const [nextCases, nextRuns] = await Promise.all([
      api.listCommercialKnowledgeEvaluationCases(knowledgeBaseId, datasetId),
      api.listCommercialKnowledgeEvaluationRuns(knowledgeBaseId, datasetId, 8),
    ]);
    setCases(nextCases);
    setRuns(nextRuns);
  };

  const loadDatasets = async (preferredId = "") => {
    setLoading(true);
    setError("");
    try {
      const nextDatasets = await api.listCommercialKnowledgeEvaluationDatasets(knowledgeBaseId);
      setDatasets(nextDatasets);
      const targetId = preferredId || (nextDatasets.some((dataset) => dataset.id === selectedDatasetId) ? selectedDatasetId : nextDatasets[0]?.id || "");
      setSelectedDatasetId(targetId);
      await loadDatasetDetail(targetId);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("knowledgeWorkspace.evaluation.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSelectedDatasetId("");
    setCases([]);
    setRuns([]);
    void loadDatasets();
    // The collection changes only when its knowledge-base selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [knowledgeBaseId]);

  const selectDataset = async (datasetId: string) => {
    setSelectedDatasetId(datasetId);
    setError("");
    try {
      await loadDatasetDetail(datasetId);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("knowledgeWorkspace.evaluation.loadFailed"));
    }
  };

  const createDataset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!datasetName.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const created = await api.createCommercialKnowledgeEvaluationDataset(knowledgeBaseId, {
        name: datasetName.trim(),
        description: datasetDescription.trim(),
      });
      setDatasetName("");
      setDatasetDescription("");
      await loadDatasets(created.id);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("knowledgeWorkspace.evaluation.createFailed"));
    } finally {
      setSaving(false);
    }
  };

  const createCase = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedDataset || !caseQuery.trim() || !expectedDocumentId || saving) return;
    setSaving(true);
    setError("");
    try {
      await api.createCommercialKnowledgeEvaluationCase(knowledgeBaseId, selectedDataset.id, {
        query: caseQuery.trim(),
        expected_document_ids: [expectedDocumentId],
      });
      setCaseQuery("");
      await loadDatasets(selectedDataset.id);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("knowledgeWorkspace.evaluation.caseFailed"));
    } finally {
      setSaving(false);
    }
  };

  const runEvaluation = async () => {
    if (!selectedDataset || running || !cases.length) return;
    setRunning(true);
    setError("");
    try {
      await api.runCommercialKnowledgeEvaluationDataset(knowledgeBaseId, selectedDataset.id, { top_k: config.top_k });
      await loadDatasets(selectedDataset.id);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("knowledgeWorkspace.evaluation.runFailed"));
    } finally {
      setRunning(false);
    }
  };

  const removeDataset = async () => {
    if (!deleteDataset || saving) return;
    setSaving(true);
    try {
      await api.deleteCommercialKnowledgeEvaluationDataset(knowledgeBaseId, deleteDataset.id);
      setDeleteDataset(null);
      await loadDatasets();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("knowledgeWorkspace.evaluation.deleteFailed"));
    } finally {
      setSaving(false);
    }
  };

  const removeCase = async () => {
    if (!deleteCase || !selectedDataset || saving) return;
    setSaving(true);
    try {
      await api.deleteCommercialKnowledgeEvaluationCase(knowledgeBaseId, selectedDataset.id, deleteCase.id);
      setDeleteCase(null);
      await loadDatasets(selectedDataset.id);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("knowledgeWorkspace.evaluation.deleteFailed"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-5"><RefreshingOverlay label={t("knowledgeWorkspace.evaluation.loading")} /></div>;
  }

  return (
    <div className="grid gap-5 p-4 md:p-5">
      <SectionHeader
        eyebrow={t("knowledgeWorkspace.evaluation.eyebrow")}
        title={t("knowledgeWorkspace.evaluation.title")}
        description={t("knowledgeWorkspace.evaluation.description")}
        actions={selectedDataset ? (
          <Button
            variant="primary"
            leftIcon={<Play className="h-4 w-4" />}
            loading={running}
            disabled={!canManage || !cases.length}
            onClick={() => void runEvaluation()}
          >
            {t("knowledgeWorkspace.evaluation.run")}
          </Button>
        ) : null}
      />

      {error ? <InlineError title={t("knowledgeWorkspace.evaluation.errorTitle")} message={error} retryLabel={t("knowledgeWorkspace.retry")} onRetry={() => void loadDatasets(selectedDatasetId)} /> : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(15rem,0.8fr)_minmax(0,1.7fr)]">
        <Panel surface="2" padding="md" className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink-strong">
            <ClipboardCheck className="h-4 w-4 text-primary" aria-hidden="true" />
            {t("knowledgeWorkspace.evaluation.datasets")}
          </div>
          {datasets.length ? (
            <Select
              value={selectedDatasetId}
              onValueChange={(value) => void selectDataset(value)}
              label={t("knowledgeWorkspace.evaluation.selectDataset")}
              options={datasets.map((dataset) => ({
                value: dataset.id,
                label: dataset.name,
                description: t("knowledgeWorkspace.evaluation.caseCount", { count: dataset.case_count }),
              }))}
              searchable
              searchPlaceholder={t("knowledgeWorkspace.evaluation.searchDatasets")}
              className="w-full"
            />
          ) : (
            <p className="text-sm leading-5 text-ink-muted">{t("knowledgeWorkspace.evaluation.emptyDatasets")}</p>
          )}

          {selectedDataset ? (
            <div className="rounded-md border border-[hsl(var(--border-subtle))] bg-surface-1 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-strong">{selectedDataset.name}</p>
                  {selectedDataset.description ? <p className="mt-1 text-xs leading-5 text-ink-muted">{selectedDataset.description}</p> : null}
                </div>
                {canManage ? (
                  <IconButton label={t("knowledgeWorkspace.evaluation.deleteDataset")} onClick={() => setDeleteDataset(selectedDataset)}>
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                ) : null}
              </div>
              {selectedDataset.latest_run_at ? <p className="mt-3 text-xs text-ink-muted">{t("knowledgeWorkspace.evaluation.lastRun", { time: formatDate(selectedDataset.latest_run_at, i18n.language) })}</p> : null}
            </div>
          ) : null}

          {canManage ? (
            <form className="grid gap-3 border-t border-[hsl(var(--border-subtle))] pt-4" onSubmit={(event) => void createDataset(event)}>
              <Field label={t("knowledgeWorkspace.evaluation.datasetName")}>
                <Input value={datasetName} onChange={(event) => setDatasetName(event.target.value)} maxLength={160} />
              </Field>
              <Field label={t("knowledgeWorkspace.evaluation.datasetDescription")}>
                <Input value={datasetDescription} onChange={(event) => setDatasetDescription(event.target.value)} maxLength={2000} />
              </Field>
              <Button type="submit" variant="outline" loading={saving} disabled={!datasetName.trim()} leftIcon={<Plus className="h-4 w-4" />}>
                {t("knowledgeWorkspace.evaluation.createDataset")}
              </Button>
            </form>
          ) : null}
        </Panel>

        <div className="grid gap-4">
          {selectedDataset ? (
            <Panel padding="md">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-ink-strong">{t("knowledgeWorkspace.evaluation.cases")}</h3>
                  <p className="mt-1 text-xs leading-5 text-ink-muted">{t("knowledgeWorkspace.evaluation.casesDescription")}</p>
                </div>
                <StatusIndicator tone="primary" label={t("knowledgeWorkspace.evaluation.caseCount", { count: cases.length })} />
              </div>

              {canManage ? (
                <form className="mt-4 grid gap-3 border-y border-[hsl(var(--border-subtle))] py-4 md:grid-cols-[minmax(0,1fr)_minmax(12rem,0.6fr)_auto] md:items-end" onSubmit={(event) => void createCase(event)}>
                  <Field label={t("knowledgeWorkspace.evaluation.caseQuery")}>
                    <Input value={caseQuery} onChange={(event) => setCaseQuery(event.target.value)} placeholder={t("knowledgeWorkspace.evaluation.caseQueryPlaceholder")} />
                  </Field>
                  <Field label={t("knowledgeWorkspace.evaluation.expectedDocument")}>
                    <Select
                      value={expectedDocumentId}
                      onValueChange={setExpectedDocumentId}
                      options={documentOptions}
                      label={t("knowledgeWorkspace.evaluation.expectedDocument")}
                      placeholder={t("knowledgeWorkspace.evaluation.selectDocument")}
                      searchable
                      searchPlaceholder={t("knowledgeWorkspace.evaluation.searchDocuments")}
                      disabled={!documentOptions.length}
                      className="w-full"
                    />
                  </Field>
                  <Button type="submit" variant="outline" loading={saving} disabled={!caseQuery.trim() || !expectedDocumentId} leftIcon={<Target className="h-4 w-4" />}>
                    {t("knowledgeWorkspace.evaluation.addCase")}
                  </Button>
                </form>
              ) : null}

              {cases.length ? (
                <div className="divide-y divide-[hsl(var(--border-subtle))]">
                  {cases.map((item, index) => {
                    const expectedDocument = documents.find((document) => document.id === item.expected_document_ids[0]);
                    return (
                      <div key={item.id} className="flex min-w-0 items-start gap-3 py-3">
                        <span className="mt-0.5 text-xs font-medium text-primary">{String(index + 1).padStart(2, "0")}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm leading-5 text-ink-strong">{item.query}</p>
                          <p className="mt-1 truncate text-xs text-ink-muted">{expectedDocument?.title || item.expected_document_ids[0] || item.expected_chunk_ids[0]}</p>
                        </div>
                        {canManage ? (
                          <IconButton label={t("knowledgeWorkspace.evaluation.deleteCase")} onClick={() => setDeleteCase(item)}>
                            <Trash2 className="h-4 w-4" />
                          </IconButton>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : <EmptyState title={t("knowledgeWorkspace.evaluation.emptyCases")} description={t("knowledgeWorkspace.evaluation.emptyCasesDescription")} />}
            </Panel>
          ) : (
            <EmptyState title={t("knowledgeWorkspace.evaluation.selectDatasetTitle")} description={t("knowledgeWorkspace.evaluation.selectDatasetDescription")} />
          )}

          {selectedDataset && runs.length ? (
            <Panel padding="md">
              <h3 className="text-sm font-semibold text-ink-strong">{t("knowledgeWorkspace.evaluation.history")}</h3>
              <div className="mt-3 divide-y divide-[hsl(var(--border-subtle))]">
                {runs.map((run) => (
                  <div key={run.id} className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_repeat(3,minmax(5rem,auto))] sm:items-center">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink-strong">{formatDate(run.created_at, i18n.language)}</p>
                      <p className="mt-0.5 text-xs text-ink-muted">{t("knowledgeWorkspace.evaluation.topK", { count: run.top_k })}</p>
                    </div>
                    <Metric label={t("knowledgeWorkspace.evaluation.hitRate")} value={formatPercent(run.summary.hit_rate)} />
                    <Metric label={t("knowledgeWorkspace.evaluation.mrr")} value={formatScore(run.summary.mrr)} />
                    <Metric label={t("knowledgeWorkspace.evaluation.matched")} value={`${run.summary.matched_cases}/${run.summary.total_cases}`} />
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}
        </div>
      </div>

      <Dialog
        open={Boolean(deleteDataset)}
        onOpenChange={(open) => { if (!open) setDeleteDataset(null); }}
        title={t("knowledgeWorkspace.evaluation.deleteDatasetTitle")}
        description={t("knowledgeWorkspace.evaluation.deleteDatasetDescription", { name: deleteDataset?.name || "" })}
        closeLabel={t("knowledgeWorkspace.close")}
        footer={<><Button variant="ghost" onClick={() => setDeleteDataset(null)}>{t("knowledgeWorkspace.cancel")}</Button><Button variant="destructive" loading={saving} onClick={() => void removeDataset()}>{t("knowledgeWorkspace.delete")}</Button></>}
      >
        <p className="text-sm leading-6 text-ink-muted">{t("knowledgeWorkspace.evaluation.deleteDatasetWarning")}</p>
      </Dialog>

      <Dialog
        open={Boolean(deleteCase)}
        onOpenChange={(open) => { if (!open) setDeleteCase(null); }}
        title={t("knowledgeWorkspace.evaluation.deleteCaseTitle")}
        description={t("knowledgeWorkspace.evaluation.deleteCaseDescription")}
        closeLabel={t("knowledgeWorkspace.close")}
        footer={<><Button variant="ghost" onClick={() => setDeleteCase(null)}>{t("knowledgeWorkspace.cancel")}</Button><Button variant="destructive" loading={saving} onClick={() => void removeCase()}>{t("knowledgeWorkspace.delete")}</Button></>}
      >
        <p className="text-sm leading-6 text-ink-muted">{deleteCase?.query}</p>
      </Dialog>
    </div>
  );
}

function formatPercent(value: number) {
  return `${Math.round(Math.max(0, Math.min(1, value || 0)) * 100)}%`;
}

function formatScore(value: number) {
  return Number.isFinite(value) ? value.toFixed(3) : "0.000";
}

function formatDate(value: string, locale: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale || undefined, { dateStyle: "medium", timeStyle: "short" });
}
