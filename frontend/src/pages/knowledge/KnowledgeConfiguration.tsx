import { useEffect, useState, type FormEvent } from "react";
import { Cpu, Database, HardDrive, Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  CommercialKnowledgeBackendStatus,
  CommercialKnowledgeBaseConfig,
  CommercialKnowledgeRetrievalMode,
} from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Field, NumberInput } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { StatusIndicator } from "@/components/ui/Status";

interface KnowledgeConfigurationProps {
  config: CommercialKnowledgeBaseConfig;
  backendStatus: CommercialKnowledgeBackendStatus | null;
  saving: boolean;
  onSave: (config: CommercialKnowledgeBaseConfig) => Promise<void> | void;
}

export function KnowledgeConfiguration({ config, backendStatus, saving, onSave }: KnowledgeConfigurationProps) {
  const { t } = useTranslation();
  const [form, setForm] = useState(config);

  useEffect(() => setForm(config), [config]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onSave(form);
  };

  const overlapInvalid = form.chunk_overlap >= form.chunk_size;

  return (
    <div className="grid gap-6 p-4 md:p-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <form onSubmit={submit} className="grid content-start gap-5">
        <div>
          <h3 className="text-sm font-semibold text-ink-strong">{t("knowledgeWorkspace.chunkingDefaults")}</h3>
          <p className="mt-1 text-sm leading-5 text-ink-muted">{t("knowledgeWorkspace.chunkingDefaultsDescription")}</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("knowledgeWorkspace.chunkSize")} hint={t("knowledgeWorkspace.chunkSizeHint")}>
            <NumberInput
              min={300}
              max={8000}
              value={form.chunk_size}
              onChange={(event) => setForm((current) => ({ ...current, chunk_size: Number(event.target.value) }))}
            />
          </Field>
          <Field
            label={t("knowledgeWorkspace.chunkOverlap")}
            hint={t("knowledgeWorkspace.chunkOverlapHint")}
            error={overlapInvalid ? t("knowledgeWorkspace.chunkOverlapError") : undefined}
          >
            <NumberInput
              min={0}
              max={Math.max(0, form.chunk_size - 1)}
              value={form.chunk_overlap}
              onChange={(event) => setForm((current) => ({ ...current, chunk_overlap: Number(event.target.value) }))}
            />
          </Field>
          <Field label={t("knowledgeWorkspace.retrievalMode")} hint={t("knowledgeWorkspace.retrievalModeHint")}>
            <Select
              value={form.retrieval_mode}
              onValueChange={(value) => setForm((current) => ({ ...current, retrieval_mode: value as CommercialKnowledgeRetrievalMode }))}
              label={t("knowledgeWorkspace.retrievalMode")}
              options={(["hybrid", "vector", "keyword"] as CommercialKnowledgeRetrievalMode[]).map((mode) => ({
                value: mode,
                label: t(`knowledgeWorkspace.retrievalModes.${mode}`),
                description: t(`knowledgeWorkspace.retrievalModeDescriptions.${mode}`),
              }))}
              className="w-full"
            />
          </Field>
          <Field label={t("knowledgeWorkspace.topK")} hint={t("knowledgeWorkspace.topKHint")}>
            <NumberInput
              min={1}
              max={20}
              value={form.top_k}
              onChange={(event) => setForm((current) => ({ ...current, top_k: Number(event.target.value) }))}
            />
          </Field>
          <Field label={t("knowledgeWorkspace.rerankEnabled")} hint={t("knowledgeWorkspace.rerankEnabledHint")}>
            <label className="flex h-9 items-center gap-2 rounded-md border border-border bg-surface-1 px-3 text-sm text-ink-strong">
              <input
                type="checkbox"
                checked={Boolean(form.rerank_enabled)}
                onChange={(event) => setForm((current) => ({ ...current, rerank_enabled: event.target.checked }))}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary/30"
              />
              <span>{t("knowledgeWorkspace.rerankEnabled")}</span>
            </label>
          </Field>
          <Field label={t("knowledgeWorkspace.rerankCandidates")} hint={t("knowledgeWorkspace.rerankCandidatesHint")}>
            <NumberInput
              min={form.top_k}
              max={50}
              disabled={!form.rerank_enabled}
              value={form.rerank_candidate_limit ?? 24}
              onChange={(event) => setForm((current) => ({ ...current, rerank_candidate_limit: Number(event.target.value) }))}
            />
          </Field>
        </div>
        <div className="flex justify-end border-t border-[hsl(var(--border-subtle))] pt-4">
          <Button type="submit" variant="primary" loading={saving} disabled={overlapInvalid} leftIcon={<Save className="h-4 w-4" />}>
            {t("knowledgeWorkspace.saveConfiguration")}
          </Button>
        </div>
      </form>

      <aside className="border-s border-[hsl(var(--border-subtle))] ps-5 max-xl:border-s-0 max-xl:border-t max-xl:ps-0 max-xl:pt-5">
        <h3 className="text-sm font-semibold text-ink-strong">{t("knowledgeWorkspace.backendStatus")}</h3>
        <div className="mt-4 grid gap-4">
          <BackendRow
            icon={Database}
            label={t("knowledgeWorkspace.vectorStorage")}
            value={backendStatus?.vector_storage?.active || backendStatus?.storage || "-"}
            status={backendStatus?.vector_storage?.pgvector_available ? "success" : "warning"}
          />
          <BackendRow
            icon={Cpu}
            label={t("knowledgeWorkspace.embeddingModel")}
            value={backendStatus ? `${backendStatus.primary.provider} / ${backendStatus.primary.model}` : "-"}
            status={backendStatus?.primary.available ? "success" : "warning"}
          />
          <BackendRow
            icon={HardDrive}
            label={t("knowledgeWorkspace.objectStorage")}
            value={backendStatus?.object_storage?.backend === "s3"
              ? `${backendStatus.object_storage.bucket || "S3"} / ${backendStatus.object_storage.backend}`
              : backendStatus?.object_storage?.backend || "local"}
            status={backendStatus?.object_storage?.available === false ? "warning" : "success"}
          />
        </div>
        {backendStatus && !backendStatus.primary.available ? (
          <p className="mt-4 border-s-2 border-s-warning bg-warning/10 px-3 py-2 text-xs leading-5 text-ink">
            {t("knowledgeWorkspace.localEmbeddingFallback", { model: backendStatus.fallback.model })}
          </p>
        ) : null}
      </aside>
    </div>
  );
}

function BackendRow({
  icon: Icon,
  label,
  value,
  status,
}: {
  icon: typeof Database;
  label: string;
  value: string;
  status: "success" | "warning";
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-xs text-ink-muted"><Icon className="h-3.5 w-3.5" />{label}</span>
        <StatusIndicator tone={status} label={status === "success" ? t("knowledgeWorkspace.available") : t("knowledgeWorkspace.fallback")} />
      </div>
      <div className="truncate font-mono text-xs text-ink-strong" title={value}>{value}</div>
    </div>
  );
}
