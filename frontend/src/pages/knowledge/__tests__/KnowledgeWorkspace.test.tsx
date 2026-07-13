import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Knowledge } from "@/pages/Knowledge";

const apiMock = vi.hoisted(() => ({
  getCommercialMe: vi.fn(),
  listKnowledgeBases: vi.fn(),
  getCommercialKnowledgeBackendStatus: vi.fn(),
  listCommercialKnowledgeDocuments: vi.fn(),
  listCommercialIngestionJobs: vi.fn(),
  getCommercialKnowledgeDocumentDetail: vi.fn(),
  listCommercialKnowledgeDocumentChunks: vi.fn(),
  updateKnowledgeBase: vi.fn(),
  createKnowledgeBase: vi.fn(),
  uploadFile: vi.fn(),
  addCommercialKnowledgeDocument: vi.fn(),
  addCommercialKnowledgeUrl: vi.fn(),
  searchCommercialKnowledge: vi.fn(),
  reindexCommercialKnowledgeDocument: vi.fn(),
  retryCommercialIngestionJob: vi.fn(),
  cancelCommercialIngestionJob: vi.fn(),
  deleteCommercialKnowledgeDocument: vi.fn(),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: apiMock };
});

const knowledgeBase = {
  id: "kb_1",
  name: "Investment Research",
  description: "Internal research documents and policies",
  config: { chunk_size: 1400, chunk_overlap: 180, retrieval_mode: "hybrid", top_k: 8 },
  access: {
    read_roles: ["owner", "admin", "member", "viewer"],
    write_roles: ["owner", "admin", "member"],
  },
  created_at: "2026-07-13T00:00:00Z",
  updated_at: "2026-07-13T01:00:00Z",
};

const document = {
  id: "doc_1",
  title: "Portfolio Risk Policy",
  source_uri: "uploads/risk-policy.pdf",
  source_type: "file",
  status: "ready",
  chunk_count: 12,
  metadata: { parser: "pdf", chunk_size: 1400, chunk_overlap: 180 },
  ingestion_status: "completed",
  ingestion_progress: 100,
  ingestion_error: "",
  created_at: "2026-07-13T00:10:00Z",
  updated_at: "2026-07-13T00:12:00Z",
};

function setup(role: "owner" | "admin" | "member" | "viewer" = "owner") {
  apiMock.getCommercialMe.mockResolvedValue({
    user_id: `user_${role}`,
    organization_id: "org_1",
    email: `${role}@example.com`,
    role,
  });
  apiMock.listKnowledgeBases.mockResolvedValue([knowledgeBase]);
  apiMock.getCommercialKnowledgeBackendStatus.mockResolvedValue({
    organization_id: "org_1",
    storage: "sqlite-fts-local",
    target_storage: "postgres-pgvector",
    vector_storage: {
      active: "sqlite-fts-local",
      configured: "sqlite-fts-local",
      pgvector_configured: true,
      pgvector_available: false,
    },
    primary: {
      provider: "siliconflow",
      model: "BAAI/bge-m3",
      available: true,
      api_key_configured: true,
      base_url_configured: true,
      disabled: false,
    },
    fallback: { provider: "local", model: "hashing-64", available: true },
  });
  apiMock.listCommercialKnowledgeDocuments.mockResolvedValue([document]);
  apiMock.listCommercialIngestionJobs.mockResolvedValue([
    {
      id: "job_1",
      knowledge_base_id: "kb_1",
      document_id: "doc_1",
      status: "completed",
      progress: 100,
      error: "",
      metadata: { stage: "completed", source_type: "file" },
      created_at: "2026-07-13T00:10:00Z",
      updated_at: "2026-07-13T00:12:00Z",
      completed_at: "2026-07-13T00:12:00Z",
    },
  ]);
  apiMock.getCommercialKnowledgeDocumentDetail.mockResolvedValue({
    ...document,
    vectorization: { status: "completed", progress: 100, embedded_chunks: 12, total_chunks: 12 },
    ingestion_history: [],
  });
  apiMock.listCommercialKnowledgeDocumentChunks.mockResolvedValue({
    count: 1,
    limit: 200,
    offset: 0,
    items: [
      {
        id: "chunk_1",
        chunk_index: 0,
        text: "Maximum portfolio drawdown must remain inside the approved risk mandate.",
        character_count: 74,
        embedding_dimensions: 1024,
        embedding_source: "siliconflow:BAAI/bge-m3",
        embedding_fallback: false,
        metadata: {},
        created_at: "2026-07-13T00:11:00Z",
      },
    ],
  });
  apiMock.updateKnowledgeBase.mockResolvedValue(knowledgeBase);
}

describe("Knowledge workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a standalone document workspace with vectorization and chunk details", async () => {
    const user = userEvent.setup();
    setup("owner");

    render(<Knowledge />, { wrapper: MemoryRouter });

    expect(await screen.findByRole("heading", { name: "Knowledge workspace" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Investment Research/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole("tab", { name: "Documents" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByText("Portfolio Risk Policy").length).toBeGreaterThan(0);
    expect(screen.getByText("12 chunks")).toBeInTheDocument();
    expect(screen.getByText("100% vectorized")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open Portfolio Risk Policy" }));

    const drawer = await screen.findByRole("dialog", { name: "Portfolio Risk Policy" });
    expect(within(drawer).getByText("siliconflow:BAAI/bge-m3")).toBeInTheDocument();
    expect(within(drawer).getByText(/Maximum portfolio drawdown/)).toBeInTheDocument();
    expect(apiMock.getCommercialKnowledgeDocumentDetail).toHaveBeenCalledWith("kb_1", "doc_1");
    expect(apiMock.listCommercialKnowledgeDocumentChunks).toHaveBeenCalledWith("kb_1", "doc_1");
  });

  it("persists knowledge-base chunk and retrieval defaults from the configuration tab", async () => {
    const user = userEvent.setup();
    setup("owner");

    render(<Knowledge />, { wrapper: MemoryRouter });
    await screen.findByRole("heading", { name: "Knowledge workspace" });
    await user.click(screen.getByRole("tab", { name: "Configuration" }));

    const chunkSize = screen.getByLabelText("Chunk size");
    expect(chunkSize).toHaveValue(1400);
    await user.clear(chunkSize);
    await user.type(chunkSize, "1000");
    await user.click(screen.getByRole("button", { name: "Save configuration" }));

    await waitFor(() => expect(apiMock.updateKnowledgeBase).toHaveBeenCalledWith("kb_1", {
      config: { chunk_size: 1000, chunk_overlap: 180, retrieval_mode: "hybrid", top_k: 8 },
    }));
  });

  it("keeps viewer access read-only at both tab and row action level", async () => {
    setup("viewer");

    render(<Knowledge />, { wrapper: MemoryRouter });

    expect((await screen.findAllByText("Portfolio Risk Policy")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Import document" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reindex Portfolio Risk Policy" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete Portfolio Risk Policy" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Configuration" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "Access" })).toBeDisabled();
  });

  it("allows retrying a failed source job before a document row exists", async () => {
    const user = userEvent.setup();
    setup("owner");
    apiMock.listCommercialIngestionJobs.mockResolvedValue([
      {
        id: "job_failed_url",
        knowledge_base_id: "kb_1",
        document_id: "",
        status: "failed",
        progress: 5,
        error: "temporary fetch failure",
        metadata: { stage: "failed", source_type: "url", title: "Market policy" },
        created_at: "2026-07-13T00:10:00Z",
        updated_at: "2026-07-13T00:12:00Z",
      },
    ]);
    apiMock.retryCommercialIngestionJob.mockResolvedValue({ status: "pending" });

    render(<Knowledge />, { wrapper: MemoryRouter });
    await screen.findByRole("heading", { name: "Knowledge workspace" });
    await user.click(screen.getByRole("tab", { name: "Ingestion jobs" }));
    await user.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(apiMock.retryCommercialIngestionJob).toHaveBeenCalledWith("kb_1", "job_failed_url"));
  });
});
