import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Settings } from "../Settings";

const apiMock = vi.hoisted(() => ({
  getLLMSettings: vi.fn(),
  getDataSourceSettings: vi.fn(),
  getKnowledgeStats: vi.fn(),
  listKnowledgeDocuments: vi.fn(),
  getChannelStatus: vi.fn(),
  getCommercialMe: vi.fn(),
  listCommercialModelProviders: vi.fn(),
  listKnowledgeBases: vi.fn(),
  getCommercialKnowledgeBackendStatus: vi.fn(),
  listCommercialKnowledgeDocuments: vi.fn(),
  listCommercialIngestionJobs: vi.fn(),
  listAuditLogs: vi.fn(),
  listModelUsage: vi.fn(),
  listSwarmPresets: vi.fn(),
  listToolPolicies: vi.fn(),
  listOrganizationMembers: vi.fn(),
  createOrganizationMember: vi.fn(),
  updateOrganizationMember: vi.fn(),
  deleteOrganizationMember: vi.fn(),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    api: apiMock,
    isAuthRequiredError: vi.fn(() => false),
  };
});

vi.mock("@/lib/apiAuth", () => ({
  getApiAuthKey: vi.fn(() => ""),
  setApiAuthKey: vi.fn(),
}));

function llmSettings() {
  return {
    provider: "siliconflow",
    model_name: "deepseek-ai/DeepSeek-V3.2",
    base_url: "https://api.siliconflow.cn/v1",
    api_key_env: "SILICONFLOW_API_KEY",
    api_key_configured: true,
    api_key_required: true,
    temperature: 0.1,
    timeout_seconds: 120,
    max_retries: 2,
    reasoning_effort: "",
    sse_timeout_seconds: 300,
    env_path: "agent/.env",
    providers: [],
  };
}

function dataSourceSettings() {
  return {
    tushare_token_configured: false,
    baostock_supported: true,
    baostock_installed: true,
    baostock_message: "BaoStock available",
    env_path: "agent/.env",
  };
}

function renderSettings(role: "owner" | "admin" | "member" | "viewer" = "owner") {
  apiMock.getLLMSettings.mockResolvedValue(llmSettings());
  apiMock.getDataSourceSettings.mockResolvedValue(dataSourceSettings());
  apiMock.getKnowledgeStats.mockResolvedValue({ status: "ok", db_path: "knowledge.db", document_count: 0, chunk_count: 0 });
  apiMock.listKnowledgeDocuments.mockResolvedValue([]);
  apiMock.getChannelStatus.mockResolvedValue({ running: false, inbound_queue: 0, outbound_queue: 0, session_count: 0, channels: {} });
  apiMock.getCommercialMe.mockResolvedValue({
    user_id: "usr_owner",
    organization_id: "org_1",
    email: "owner@example.com",
    role,
  });
  apiMock.listCommercialModelProviders.mockResolvedValue([]);
  apiMock.listKnowledgeBases.mockResolvedValue([]);
  apiMock.getCommercialKnowledgeBackendStatus.mockResolvedValue(null);
  apiMock.listCommercialKnowledgeDocuments.mockResolvedValue([]);
  apiMock.listCommercialIngestionJobs.mockResolvedValue([]);
  apiMock.listAuditLogs.mockResolvedValue([]);
  apiMock.listModelUsage.mockResolvedValue([]);
  apiMock.listSwarmPresets.mockResolvedValue([]);
  apiMock.listToolPolicies.mockResolvedValue([]);
  apiMock.listOrganizationMembers.mockResolvedValue([
    {
      user_id: "usr_owner",
      email: "owner@example.com",
      display_name: "Owner",
      role: "owner",
      created_at: "2026-07-12T00:00:00Z",
    },
    {
      user_id: "usr_viewer",
      email: "viewer@example.com",
      display_name: "Viewer",
      role: "viewer",
      created_at: "2026-07-12T00:00:00Z",
    },
  ]);

  return render(
    <MemoryRouter initialEntries={["/settings?section=security"]}>
      <Settings />
    </MemoryRouter>,
  );
}

describe("Settings organization member management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes organization member management to the dedicated administration page", async () => {
    renderSettings("owner");

    expect(await screen.findByText("Organization administration")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open user management" })).toHaveAttribute("href", "/admin/users");
    expect(screen.queryByRole("button", { name: "Add member" })).not.toBeInTheDocument();
  });

  it("does not duplicate organization mutation controls inside personal settings", async () => {
    renderSettings("owner");

    expect(await screen.findByRole("link", { name: "Open user management" })).toBeInTheDocument();
    expect(apiMock.createOrganizationMember).not.toHaveBeenCalled();
    expect(apiMock.listCommercialModelProviders).not.toHaveBeenCalled();
    expect(apiMock.listKnowledgeBases).not.toHaveBeenCalled();
    expect(apiMock.listAuditLogs).not.toHaveBeenCalled();
    expect(apiMock.listModelUsage).not.toHaveBeenCalled();
    expect(apiMock.listSwarmPresets).not.toHaveBeenCalled();
    expect(apiMock.listToolPolicies).not.toHaveBeenCalled();
  });

  it("lets viewers see their permission boundary without management controls", async () => {
    renderSettings("viewer");

    expect(await screen.findByText("Member management requires Owner or Admin access.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add member" })).not.toBeInTheDocument();
    expect(apiMock.listOrganizationMembers).not.toHaveBeenCalled();
  });
});
