import { Database, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CommercialKnowledgeBase } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/utils";

interface KnowledgeBaseListProps {
  knowledgeBases: CommercialKnowledgeBase[];
  selectedId: string;
  selectedDocumentCount: number;
  canCreate: boolean;
  onSelect: (knowledgeBaseId: string) => void;
  onCreate: () => void;
}

export function KnowledgeBaseList({
  knowledgeBases,
  selectedId,
  selectedDocumentCount,
  canCreate,
  onSelect,
  onCreate,
}: KnowledgeBaseListProps) {
  const { t } = useTranslation();

  const mobileSelect = (
    <Select
      value={selectedId}
      onValueChange={onSelect}
      options={knowledgeBases.map((knowledgeBase) => ({
        value: knowledgeBase.id,
        label: knowledgeBase.name,
        description: knowledgeBase.description,
      }))}
      label={t("knowledgeWorkspace.knowledgeBase")}
      placeholder={t("knowledgeWorkspace.selectKnowledgeBase")}
      className="w-full"
      contentClassName="w-[min(24rem,calc(100vw-1rem))]"
    />
  );

  return (
    <>
      <div className="border-b border-[hsl(var(--border-subtle))] p-3 lg:hidden">{mobileSelect}</div>
      <aside className="hidden min-h-0 border-e border-[hsl(var(--border-subtle))] bg-surface-1 lg:flex lg:w-[260px] lg:shrink-0 lg:flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-[hsl(var(--border-subtle))] px-3 py-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink-strong">{t("knowledgeWorkspace.bases")}</h2>
            <p className="mt-0.5 text-xs text-ink-muted">{t("knowledgeWorkspace.baseCount", { count: knowledgeBases.length })}</p>
          </div>
          {canCreate ? (
            <Button variant="ghost" size="icon" aria-label={t("knowledgeWorkspace.createBase")} onClick={onCreate}>
              <Plus className="h-4 w-4" aria-hidden="true" />
            </Button>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {knowledgeBases.map((knowledgeBase) => {
            const selected = knowledgeBase.id === selectedId;
            return (
              <button
                key={knowledgeBase.id}
                type="button"
                onClick={() => onSelect(knowledgeBase.id)}
                aria-pressed={selected}
                aria-label={`${knowledgeBase.name}, ${selected ? selectedDocumentCount : 0} ${t("knowledgeWorkspace.documentsLower")}`}
                className={cn(
                  "group relative mb-1 w-full rounded-md border-s-2 px-3 py-2.5 text-start",
                  "transition-[color,background-color,border-color,box-shadow] duration-fast ease-standard",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                  selected
                    ? "border-s-primary bg-primary/10 text-ink-strong shadow-xs"
                    : "border-s-transparent text-ink hover:bg-surface-2",
                )}
              >
                <span className="flex items-start gap-2.5">
                  <Database className={cn("mt-0.5 h-4 w-4 shrink-0", selected ? "text-primary" : "text-ink-muted")} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{knowledgeBase.name}</span>
                    <span className="mt-1 line-clamp-2 block text-xs leading-4 text-ink-muted">
                      {knowledgeBase.description || t("knowledgeWorkspace.noDescription")}
                    </span>
                    {selected ? (
                      <span className="mt-2 block text-[11px] tabular-nums text-primary">
                        {t("knowledgeWorkspace.documentCount", { count: selectedDocumentCount })}
                      </span>
                    ) : null}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </aside>
    </>
  );
}
