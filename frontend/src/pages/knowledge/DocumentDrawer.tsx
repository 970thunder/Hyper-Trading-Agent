import { Braces, FileText, Layers3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  CommercialKnowledgeChunk,
  CommercialKnowledgeDocument,
  CommercialKnowledgeDocumentDetail,
} from "@/lib/api";
import { Drawer } from "@/components/ui/Drawer";
import { Progress } from "@/components/ui/Progress";
import { Skeleton } from "@/components/ui/AsyncState";
import { StatusIndicator } from "@/components/ui/Status";

interface DocumentDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: CommercialKnowledgeDocument | null;
  detail: CommercialKnowledgeDocumentDetail | null;
  chunks: CommercialKnowledgeChunk[];
  loading: boolean;
  error: string;
}

export function DocumentDrawer({ open, onOpenChange, document, detail, chunks, loading, error }: DocumentDrawerProps) {
  const { t } = useTranslation();
  const title = document?.title || t("knowledgeWorkspace.documentDetails");

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={document?.source_uri}
      closeLabel={t("knowledgeWorkspace.close")}
      className="w-[min(42rem,calc(100vw-1rem))]"
    >
      {loading ? (
        <div className="grid gap-5 p-4">
          <div className="grid grid-cols-3 gap-3">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
          <Skeleton className="h-64" />
        </div>
      ) : error ? (
        <div className="m-4 rounded-md border border-danger/25 bg-danger/10 p-4 text-sm text-danger">{error}</div>
      ) : detail ? (
        <div data-page-enter className="grid gap-5 p-4">
          <section aria-label={t("knowledgeWorkspace.vectorization")} className="grid gap-3 sm:grid-cols-3">
            <Metric icon={Layers3} label={t("knowledgeWorkspace.chunks")} value={String(detail.chunk_count)} />
            <Metric icon={Braces} label={t("knowledgeWorkspace.vectorDimensions")} value={String(chunks[0]?.embedding_dimensions || 0)} />
            <Metric icon={FileText} label={t("knowledgeWorkspace.parser")} value={String(detail.metadata?.parser || detail.source_type)} />
          </section>

          <section className="border-y border-[hsl(var(--border-subtle))] py-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-ink-strong">{t("knowledgeWorkspace.vectorization")}</h3>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {t("knowledgeWorkspace.embeddedChunks", {
                    embedded: detail.vectorization.embedded_chunks,
                    total: detail.vectorization.total_chunks,
                  })}
                </p>
              </div>
              <StatusIndicator
                tone={detail.vectorization.status === "completed" ? "success" : detail.vectorization.status === "degraded" ? "danger" : "warning"}
                label={t("knowledgeWorkspace.vectorized", { progress: detail.vectorization.progress })}
              />
            </div>
            <Progress value={detail.vectorization.progress} label={t("knowledgeWorkspace.vectorizationProgress")} />
            {detail.vectorization.reason ? (
              <p className="mt-2 break-words text-xs leading-5 text-danger">{detail.vectorization.reason}</p>
            ) : null}
            {chunks[0] ? (
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
                <span>{t("knowledgeWorkspace.embeddingSource")}: <span className="font-mono text-ink">{chunks[0].embedding_source}</span></span>
                <span>{chunks[0].embedding_fallback ? t("knowledgeWorkspace.embeddingFallback") : t("knowledgeWorkspace.embeddingPrimary")}</span>
              </div>
            ) : null}
          </section>

          <section>
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-ink-strong">{t("knowledgeWorkspace.chunkPreview")}</h3>
                <p className="mt-0.5 text-xs text-ink-muted">{t("knowledgeWorkspace.chunkPreviewDescription")}</p>
              </div>
              <span className="text-xs tabular-nums text-ink-muted">{t("knowledgeWorkspace.chunkCount", { count: chunks.length })}</span>
            </div>
            <div className="divide-y divide-[hsl(var(--border-subtle))] border-y border-[hsl(var(--border-subtle))]">
              {chunks.map((chunk) => (
                <article key={chunk.id} className="py-3 [content-visibility:auto] [contain-intrinsic-size:0_110px]">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-muted">
                    <span className="font-mono">#{chunk.chunk_index + 1} / {chunk.id}</span>
                    <span className="tabular-nums">{t("knowledgeWorkspace.characters", { count: chunk.character_count })}</span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm leading-6 text-ink">{chunk.text}</p>
                </article>
              ))}
              {!chunks.length ? <div className="py-10 text-center text-sm text-ink-muted">{t("knowledgeWorkspace.noChunks")}</div> : null}
            </div>
          </section>
        </div>
      ) : null}
    </Drawer>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof FileText; label: string; value: string }) {
  return (
    <div className="min-w-0 border-s-2 border-s-primary/35 bg-surface-2 px-3 py-2.5">
      <div className="flex items-center gap-2 text-xs text-ink-muted">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-2 truncate text-lg font-semibold tabular-nums text-ink-strong">{value}</div>
    </div>
  );
}
