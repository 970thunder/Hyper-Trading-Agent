import { fireEvent, render, screen } from "@testing-library/react";
import type { FormEvent } from "react";
import { KnowledgeSettingsPanel } from "../KnowledgeSettingsPanel";
import type {
  CommercialIngestionJob,
  CommercialKnowledgeBackendStatus,
  CommercialKnowledgeBase,
  CommercialKnowledgeDocument,
  CommercialKnowledgeSearchResult,
  CommercialPrincipal,
  KnowledgeDocument,
  KnowledgeStats,
} from "@/lib/api";

const principal: CommercialPrincipal = {
  user_id: "u1",
  organization_id: "org1",
  email: "owner@example.com",
  role: "owner",
};

const knowledgeBases: CommercialKnowledgeBase[] = [
  {
    id: "kb-1",
    name: "Research KB",
    description: "Research notes",
    created_at: "2026-07-12T00:00:00Z",
    updated_at: "2026-07-12T00:00:00Z",
  },
];

const backendStatus: CommercialKnowledgeBackendStatus = {
  organization_id: "org1",
  storage: "sqlite",
  target_storage: "pgvector",
  primary: {
    provider: "siliconflow",
    model: "BAAI/bge-m3",
    available: true,
    api_key_configured: true,
    base_url_configured: true,
    disabled: false,
  },
  fallback: {
    provider: "local",
    model: "hashing",
    available: true,
  },
};

const commercialDocuments: CommercialKnowledgeDocument[] = [
  {
    id: "doc-1",
    title: "Research note",
    source_uri: "uploads/research.md",
    source_type: "file",
    status: "ready",
    chunk_count: 8,
    created_at: "2026-07-12T00:00:00Z",
    updated_at: "2026-07-12T00:00:00Z",
    ingestion_status: "completed",
    ingestion_progress: 100,
  },
];

const jobs: CommercialIngestionJob[] = [
  {
    id: "job-1",
    knowledge_base_id: "kb-1",
    document_id: "doc-1",
    status: "completed",
    progress: 100,
    error: "",
    created_at: "2026-07-12T00:00:00Z",
    updated_at: "2026-07-12T00:00:00Z",
  },
];

const searchResults: CommercialKnowledgeSearchResult[] = [
  {
    document_id: "doc-1",
    chunk_id: "chunk-1",
    title: "Research note",
    source_uri: "uploads/research.md",
    score: 0.91,
    text: "A sample research chunk.",
    citation: "Research note#chunk-1",
  },
];

const localStats: KnowledgeStats = {
  status: "ready",
  db_path: "agent/knowledge.db",
  document_count: 1,
  chunk_count: 4,
};

const localDocuments: KnowledgeDocument[] = [
  {
    id: "local-doc",
    title: "Local note",
    source_path: "notes/local.md",
    source_hash: "hash",
    chunk_count: 4,
    created_at: "2026-07-12T00:00:00Z",
  },
];

function noopSubmit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
}

describe("KnowledgeSettingsPanel", () => {
  it("renders commercial RAG controls and callbacks", () => {
    const onRefresh = vi.fn();
    const onKnowledgeBaseChange = vi.fn();

    render(
      <KnowledgeSettingsPanel
        principal={principal}
        loadError=""
        knowledgeStats={null}
        localDocuments={[]}
        knowledgeBases={knowledgeBases}
        selectedKnowledgeBaseId="kb-1"
        backendStatus={backendStatus}
        commercialDocuments={commercialDocuments}
        ingestionJobs={jobs}
        searchResults={searchResults}
        knowledgeTitle=""
        knowledgePath=""
        knowledgeUrl=""
        knowledgeQuery="risk"
        hasKnowledgeFile={false}
        creatingKnowledgeBase={false}
        knowledgeSaving={false}
        knowledgeSearching={false}
        knowledgeJobAction={null}
        onRefresh={onRefresh}
        onCreateDefaultKnowledgeBase={vi.fn()}
        onKnowledgeBaseChange={onKnowledgeBaseChange}
        onTitleChange={vi.fn()}
        onPathChange={vi.fn()}
        onUrlChange={vi.fn()}
        onQueryChange={vi.fn()}
        onFileChange={vi.fn()}
        onSubmitKnowledge={noopSubmit}
        onSubmitSearch={noopSubmit}
        onReindexDocument={vi.fn()}
        onRetryJob={vi.fn()}
        onCancelJob={vi.fn()}
      />,
    );

    expect(screen.getByText("Knowledge / RAG")).toBeInTheDocument();
    expect(screen.getByText("Commercial KB")).toBeInTheDocument();
    expect(screen.getByText("Research KB")).toBeInTheDocument();
    expect(screen.getByText("Primary embedding is active: siliconflow / BAAI/bge-m3.")).toBeInTheDocument();
    expect(screen.getByText("Research note#chunk-1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Knowledge base"), { target: { value: "kb-1" } });
    expect(onKnowledgeBaseChange).toHaveBeenCalledWith("kb-1");
  });

  it("renders local fallback RAG controls", () => {
    render(
      <KnowledgeSettingsPanel
        principal={null}
        loadError=""
        knowledgeStats={localStats}
        localDocuments={localDocuments}
        knowledgeBases={[]}
        selectedKnowledgeBaseId=""
        backendStatus={null}
        commercialDocuments={[]}
        ingestionJobs={[]}
        searchResults={[]}
        knowledgeTitle=""
        knowledgePath="notes/local.md"
        knowledgeUrl=""
        knowledgeQuery=""
        hasKnowledgeFile={false}
        creatingKnowledgeBase={false}
        knowledgeSaving={false}
        knowledgeSearching={false}
        knowledgeJobAction={null}
        onRefresh={vi.fn()}
        onCreateDefaultKnowledgeBase={vi.fn()}
        onKnowledgeBaseChange={vi.fn()}
        onTitleChange={vi.fn()}
        onPathChange={vi.fn()}
        onUrlChange={vi.fn()}
        onQueryChange={vi.fn()}
        onFileChange={vi.fn()}
        onSubmitKnowledge={noopSubmit}
        onSubmitSearch={noopSubmit}
        onReindexDocument={vi.fn()}
        onRetryJob={vi.fn()}
        onCancelJob={vi.fn()}
      />,
    );

    expect(screen.getByText("agent/knowledge.db")).toBeInTheDocument();
    expect(screen.getByText("Local note")).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });
});
