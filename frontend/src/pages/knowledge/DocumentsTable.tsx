import { ExternalLink, FileText, RefreshCw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CommercialKnowledgeDocument } from "@/lib/api";
import { Button, IconButton } from "@/components/ui/Button";
import { Progress } from "@/components/ui/Progress";
import { StatusIndicator } from "@/components/ui/Status";

interface DocumentsTableProps {
  documents: CommercialKnowledgeDocument[];
  canWrite: boolean;
  actionId: string | null;
  onOpen: (document: CommercialKnowledgeDocument) => void;
  onReindex: (document: CommercialKnowledgeDocument) => void;
  onDelete: (document: CommercialKnowledgeDocument) => void;
}

export function DocumentsTable({ documents, canWrite, actionId, onOpen, onReindex, onDelete }: DocumentsTableProps) {
  const { t } = useTranslation();

  if (!documents.length) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center border-t border-[hsl(var(--border-subtle))] px-6 text-center">
        <FileText className="h-7 w-7 text-ink-disabled" aria-hidden="true" />
        <h3 className="mt-3 text-sm font-semibold text-ink-strong">{t("knowledgeWorkspace.documentsEmpty")}</h3>
        <p className="mt-1 max-w-md text-sm leading-5 text-ink-muted">{t("knowledgeWorkspace.documentsEmptyDescription")}</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] border-separate border-spacing-0 text-sm">
        <thead>
          <tr className="text-start text-xs text-ink-muted">
            <th className="sticky top-0 z-sticky border-b border-[hsl(var(--border-subtle))] bg-surface-2 px-4 py-2.5 text-start font-medium">{t("knowledgeWorkspace.document")}</th>
            <th className="sticky top-0 z-sticky border-b border-[hsl(var(--border-subtle))] bg-surface-2 px-3 py-2.5 text-start font-medium">{t("knowledgeWorkspace.parser")}</th>
            <th className="sticky top-0 z-sticky border-b border-[hsl(var(--border-subtle))] bg-surface-2 px-3 py-2.5 text-start font-medium">{t("knowledgeWorkspace.chunks")}</th>
            <th className="sticky top-0 z-sticky w-44 border-b border-[hsl(var(--border-subtle))] bg-surface-2 px-3 py-2.5 text-start font-medium">{t("knowledgeWorkspace.vectorization")}</th>
            <th className="sticky top-0 z-sticky border-b border-[hsl(var(--border-subtle))] bg-surface-2 px-3 py-2.5 text-start font-medium">{t("knowledgeWorkspace.updated")}</th>
            <th className="sticky top-0 z-sticky border-b border-[hsl(var(--border-subtle))] bg-surface-2 px-3 py-2.5 text-end font-medium">{t("knowledgeWorkspace.actions")}</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((document) => {
            const progress = document.ingestion_progress ?? (document.status === "ready" ? 100 : 0);
            const status = document.ingestion_status || document.status;
            const parser = String(document.metadata?.parser || document.source_type || "-");
            return (
              <tr key={document.id} className="group transition-colors duration-fast hover:bg-surface-2/70">
                <td className="border-b border-[hsl(var(--border-subtle))] px-4 py-3 align-top">
                  <button
                    type="button"
                    onClick={() => onOpen(document)}
                    aria-label={t("knowledgeWorkspace.openDocument", { title: document.title })}
                    className="max-w-[22rem] text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  >
                    <span className="block truncate font-medium text-ink-strong group-hover:text-primary">{document.title}</span>
                    <span className="mt-1 flex max-w-[22rem] items-center gap-1 truncate text-xs text-ink-muted">
                      <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span className="truncate">{document.source_uri}</span>
                    </span>
                  </button>
                </td>
                <td className="border-b border-[hsl(var(--border-subtle))] px-3 py-3 align-top font-mono text-xs text-ink-muted">{parser}</td>
                <td className="border-b border-[hsl(var(--border-subtle))] px-3 py-3 align-top tabular-nums text-ink">
                  {t("knowledgeWorkspace.chunkCount", { count: document.chunk_count })}
                </td>
                <td className="border-b border-[hsl(var(--border-subtle))] px-3 py-3 align-top">
                  <div className="grid gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <StatusIndicator tone={statusTone(status)} label={t(`knowledgeWorkspace.status.${normalizeStatus(status)}`)} />
                      <span className="text-[11px] tabular-nums text-ink-muted">{t("knowledgeWorkspace.vectorized", { progress })}</span>
                    </div>
                    <Progress value={progress} label={t("knowledgeWorkspace.vectorizationProgress")} />
                  </div>
                </td>
                <td className="border-b border-[hsl(var(--border-subtle))] px-3 py-3 align-top text-xs tabular-nums text-ink-muted">
                  {formatDate(document.updated_at)}
                </td>
                <td className="border-b border-[hsl(var(--border-subtle))] px-3 py-2.5 align-top">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => onOpen(document)}>
                      {t("knowledgeWorkspace.details")}
                    </Button>
                    {canWrite ? (
                      <IconButton
                        label={t("knowledgeWorkspace.reindexDocument", { title: document.title })}
                        loading={actionId === `reindex:${document.id}`}
                        onClick={() => onReindex(document)}
                      >
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                      </IconButton>
                    ) : null}
                    {canWrite ? (
                      <IconButton
                        label={t("knowledgeWorkspace.deleteDocument", { title: document.title })}
                        variant="ghost"
                        className="text-danger hover:bg-danger/10 hover:text-danger"
                        onClick={() => onDelete(document)}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </IconButton>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function normalizeStatus(status: string) {
  const value = status.toLowerCase();
  if (["completed", "ready"].includes(value)) return "completed";
  if (["running", "indexing"].includes(value)) return "running";
  if (["pending", "queued"].includes(value)) return "pending";
  if (["cancelled", "canceled"].includes(value)) return "cancelled";
  if (["failed", "error"].includes(value)) return "failed";
  return "pending";
}

function statusTone(status: string): "success" | "warning" | "danger" | "neutral" {
  const normalized = normalizeStatus(status);
  if (normalized === "completed") return "success";
  if (normalized === "failed") return "danger";
  if (normalized === "running" || normalized === "pending") return "warning";
  return "neutral";
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "-";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
