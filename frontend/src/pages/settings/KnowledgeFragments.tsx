import type { CommercialKnowledgeSearchResult, KnowledgeSearchResult } from "@/lib/api";

export function KnowledgeDocumentTable({
  rows,
  titleLabel,
  chunksLabel,
  sourceLabel,
  statusLabel,
  actionsLabel,
  reindexLabel,
  loadingLabel,
  actionBusyId,
  onReindex,
}: {
  rows: Array<{ id: string; title: string; chunkCount: number; source: string; status: string; ingestionStatus?: string; ingestionProgress?: number; ingestionError?: string }>;
  titleLabel: string;
  chunksLabel: string;
  sourceLabel: string;
  statusLabel: string;
  actionsLabel?: string;
  reindexLabel?: string;
  loadingLabel?: string;
  actionBusyId?: string | null;
  onReindex?: (documentId: string) => void;
}) {
  return (
    <div className="mt-5 overflow-hidden rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">{titleLabel}</th>
            <th className="px-3 py-2 text-left font-medium">{chunksLabel}</th>
            <th className="px-3 py-2 text-left font-medium">{statusLabel}</th>
            <th className="px-3 py-2 text-left font-medium">{sourceLabel}</th>
            {onReindex ? <th className="px-3 py-2 text-right font-medium">{actionsLabel}</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((doc) => (
            <tr key={doc.id} className="border-t">
              <td className="px-3 py-2 align-top font-medium">{doc.title}</td>
              <td className="px-3 py-2 align-top text-muted-foreground">{doc.chunkCount}</td>
              <td className="px-3 py-2 align-top text-muted-foreground">
                <div>{doc.ingestionStatus || doc.status}</div>
                {doc.ingestionStatus ? (
                  <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, Number(doc.ingestionProgress || 0)))}%` }} />
                  </div>
                ) : null}
                {doc.ingestionError ? <div className="mt-1 max-w-48 truncate text-xs text-destructive" title={doc.ingestionError}>{doc.ingestionError}</div> : null}
              </td>
              <td className="max-w-md truncate px-3 py-2 align-top text-xs text-muted-foreground" title={doc.source}>{doc.source}</td>
              {onReindex ? (
                <td className="px-3 py-2 text-right align-top">
                  <button
                    type="button"
                    onClick={() => onReindex(doc.id)}
                    disabled={actionBusyId === `reindex:${doc.id}`}
                    className="rounded-md border px-2 py-1 text-xs transition hover:bg-muted disabled:opacity-60"
                  >
                    {actionBusyId === `reindex:${doc.id}` ? loadingLabel : reindexLabel}
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function KnowledgeSearchResults({
  results,
  emptyLabel,
}: {
  results: Array<CommercialKnowledgeSearchResult | KnowledgeSearchResult>;
  emptyLabel: string;
}) {
  if (!results.length) {
    return <div className="mt-4 rounded-md border bg-muted/20 px-3 py-4 text-center text-sm text-muted-foreground">{emptyLabel}</div>;
  }
  return (
    <div className="mt-4 space-y-3">
      {results.map((item) => (
        <div key={item.chunk_id} className="rounded-md border bg-background p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium">{item.title}</div>
            <div className="text-xs text-muted-foreground">{Number(item.score).toFixed(4)}</div>
          </div>
          <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{item.text}</p>
          <div className="mt-2 truncate text-xs text-primary" title={item.citation}>{item.citation}</div>
        </div>
      ))}
    </div>
  );
}
