import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CommercialKnowledgeBaseConfig, CommercialKnowledgeSearchResult } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { StatusIndicator } from "@/components/ui/Status";

interface SearchEvaluationProps {
  config: CommercialKnowledgeBaseConfig;
  query: string;
  searching: boolean;
  results: CommercialKnowledgeSearchResult[];
  onQueryChange: (query: string) => void;
  onSearch: () => void;
}

export function SearchEvaluation({ config, query, searching, results, onQueryChange, onSearch }: SearchEvaluationProps) {
  const { t } = useTranslation();

  return (
    <div className="grid gap-5 p-4 md:p-5">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSearch();
        }}
        className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end"
      >
        <Field label={t("knowledgeWorkspace.searchQuery")} hint={t("knowledgeWorkspace.searchDescription")}>
          <Input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={t("knowledgeWorkspace.searchPlaceholder")} />
        </Field>
        <Button type="submit" variant="primary" loading={searching} disabled={!query.trim()} leftIcon={<Search className="h-4 w-4" />}>
          {t("knowledgeWorkspace.runSearch")}
        </Button>
      </form>

      <div className="flex flex-wrap items-center gap-2 border-y border-[hsl(var(--border-subtle))] py-3 text-xs text-ink-muted">
        <StatusIndicator tone="primary" label={t(`knowledgeWorkspace.retrievalModes.${config.retrieval_mode}`)} />
        <span>{t("knowledgeWorkspace.topKSummary", { count: config.top_k })}</span>
        <span>{t("knowledgeWorkspace.resultCount", { count: results.length })}</span>
      </div>

      {results.length ? (
        <div className="divide-y divide-[hsl(var(--border-subtle))]">
          {results.map((result, index) => (
            <article key={result.chunk_id} className="grid gap-3 py-4 md:grid-cols-[80px_minmax(0,1fr)]">
              <div>
                <div className="text-xs text-ink-muted">{t("knowledgeWorkspace.score")}</div>
                <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-ink-strong">{formatScore(result.score)}</div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(2, Math.min(100, result.score * 100))}%` }} />
                </div>
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-primary">#{index + 1}</span>
                  <h3 className="truncate text-sm font-semibold text-ink-strong">{result.title}</h3>
                  <span className="font-mono text-[11px] text-ink-muted">{result.chunk_id}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-ink">{result.text}</p>
                <div className="mt-3 border-s-2 border-s-accent bg-surface-2 px-3 py-2 text-xs leading-5 text-ink-muted">
                  <span className="font-medium text-ink-strong">{t("knowledgeWorkspace.citation")}: </span>
                  {result.citation}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="py-12 text-center text-sm text-ink-muted">{t("knowledgeWorkspace.searchEmpty")}</div>
      )}
    </div>
  );
}

function formatScore(value: number) {
  return Number.isFinite(value) ? value.toFixed(3) : "0.000";
}
