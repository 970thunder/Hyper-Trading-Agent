import { fireEvent, render, screen } from "@testing-library/react";
import { KnowledgeDocumentTable, KnowledgeSearchResults } from "../KnowledgeFragments";
import type { CommercialKnowledgeSearchResult } from "@/lib/api";

describe("KnowledgeFragments", () => {
  it("renders document lifecycle rows and reindex action", () => {
    const onReindex = vi.fn();

    render(
      <KnowledgeDocumentTable
        rows={[
          {
            id: "doc-1",
            title: "Research note",
            chunkCount: 8,
            source: "uploads/research.md",
            status: "ready",
            ingestionStatus: "completed",
            ingestionProgress: 100,
          },
        ]}
        titleLabel="Document"
        chunksLabel="Chunks"
        sourceLabel="Source"
        statusLabel="Status"
        actionsLabel="Actions"
        reindexLabel="Reindex"
        loadingLabel="Loading"
        onReindex={onReindex}
      />,
    );

    expect(screen.getByText("Research note")).toBeInTheDocument();
    expect(screen.getByText("completed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reindex" }));
    expect(onReindex).toHaveBeenCalledWith("doc-1");
  });

  it("renders knowledge search citations", () => {
    const results: CommercialKnowledgeSearchResult[] = [
      {
        document_id: "doc-1",
        chunk_id: "chunk-1",
        title: "Macro thesis",
        source_uri: "uploads/macro.md",
        score: 0.875,
        text: "Liquidity conditions improved in the latest sample.",
        citation: "Macro thesis#chunk-1",
      },
    ];

    render(<KnowledgeSearchResults results={results} emptyLabel="No results" />);

    expect(screen.getByText("Macro thesis")).toBeInTheDocument();
    expect(screen.getByText("Macro thesis#chunk-1")).toBeInTheDocument();
    expect(screen.getByText("0.8750")).toBeInTheDocument();
  });
});
