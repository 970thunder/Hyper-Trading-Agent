import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Admin } from "../Admin";

const apiMock = vi.hoisted(() => ({
  getCommercialMe: vi.fn(),
  getCurrentOrganization: vi.fn(),
  listOrganizationMembers: vi.fn(),
  listCommercialModelProviders: vi.fn(),
  listKnowledgeBases: vi.fn(),
  listRuntimeJobs: vi.fn(),
  listAuditLogs: vi.fn(),
  listModelUsage: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: apiMock,
}));

describe("Admin page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.getCommercialMe.mockResolvedValue({
      user_id: "u_owner",
      organization_id: "org_1",
      email: "owner@example.com",
      role: "owner",
    });
    apiMock.getCurrentOrganization.mockResolvedValue({
      id: "org_1",
      name: "Hyper Research",
      created_at: "2026-07-12T00:00:00Z",
    });
    apiMock.listOrganizationMembers.mockResolvedValue([
      { user_id: "u_owner", email: "owner@example.com", display_name: "Owner", role: "owner", created_at: "2026-07-12T00:00:00Z" },
      { user_id: "u_admin", email: "admin@example.com", display_name: "Admin", role: "admin", created_at: "2026-07-12T00:00:00Z" },
      { user_id: "u_member", email: "member@example.com", display_name: "Member", role: "member", created_at: "2026-07-12T00:00:00Z" },
    ]);
    apiMock.listCommercialModelProviders.mockResolvedValue([
      {
        id: "model_1",
        provider: "siliconflow",
        model: "deepseek-ai/DeepSeek-V3.2",
        base_url: "https://api.siliconflow.cn/v1",
        api_key_configured: true,
        temperature: 0.2,
        timeout_seconds: 120,
        max_retries: 2,
        enabled: true,
        is_default: true,
        created_at: "2026-07-12T00:00:00Z",
        updated_at: "2026-07-12T00:00:00Z",
      },
      {
        id: "model_2",
        provider: "openrouter",
        model: "deepseek/deepseek-chat",
        base_url: "https://openrouter.ai/api/v1",
        api_key_configured: false,
        temperature: 0,
        timeout_seconds: 120,
        max_retries: 2,
        enabled: false,
        is_default: false,
        created_at: "2026-07-12T00:00:00Z",
        updated_at: "2026-07-12T00:00:00Z",
      },
    ]);
    apiMock.listKnowledgeBases.mockResolvedValue([
      { id: "kb_1", name: "Research KB", description: "", created_at: "2026-07-12T00:00:00Z", updated_at: "2026-07-12T00:00:00Z" },
    ]);
    apiMock.listRuntimeJobs.mockResolvedValue([
      { job_id: "job_1", kind: "alpha_bench", title: "Alpha bench csi300", status: "running", progress: 45, created_at: "2026-07-12T00:00:00Z", updated_at: "2026-07-12T00:01:00Z" },
      { job_id: "job_2", kind: "alpha_compare", title: "Alpha compare", status: "failed", progress: 100, error: "factor load failed", created_at: "2026-07-12T00:00:00Z", updated_at: "2026-07-12T00:02:00Z" },
    ]);
    apiMock.listAuditLogs.mockResolvedValue([
      { id: "audit_1", action: "model_provider.create", target_type: "model_provider", target_id: "model_1", metadata: {}, user_id: "u_owner", created_at: "2026-07-12T00:00:00Z" },
    ]);
    apiMock.listModelUsage.mockResolvedValue([
      { id: "usage_1", provider: "siliconflow", model: "deepseek-ai/DeepSeek-V3.2", prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, latency_ms: 1200, estimated_cost: 0.03, created_at: "2026-07-12T00:00:00Z" },
    ]);
  });

  it("renders organization governance summary from commercial APIs", async () => {
    render(<Admin />, { wrapper: MemoryRouter });

    expect(await screen.findByText("Admin Console")).toBeInTheDocument();
    expect(screen.getByText("Hyper Research")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("2 privileged")).toBeInTheDocument();
    expect(screen.getByText("Knowledge bases")).toBeInTheDocument();
    expect(screen.getByText("Failed jobs")).toBeInTheDocument();
    expect(screen.getByText("150")).toBeInTheDocument();
    expect(screen.getAllByText("deepseek-ai/DeepSeek-V3.2").length).toBeGreaterThan(0);
    expect(screen.getAllByText("model_provider.create").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Alpha bench csi300").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Manage models" })).toHaveAttribute("href", "/admin/models");
  });

  it("filters governance records and exposes direct operation shortcuts", async () => {
    const user = userEvent.setup();
    render(<Admin />, { wrapper: MemoryRouter });

    expect(await screen.findByText("Admin Console")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Search members, models, jobs, audit..."), "openrouter");

    const ledger = screen.getByRole("region", { name: "Governance records" });
    expect(within(ledger).getByText("openrouter")).toBeInTheDocument();
    expect(within(ledger).getByRole("link", { name: "Review model" })).toHaveAttribute("href", "/admin/models");
    expect(within(ledger).queryByText("Alpha bench csi300")).not.toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText("Search members, models, jobs, audit..."));
    await user.selectOptions(screen.getByLabelText("Status filter"), "failed");

    expect(within(ledger).getByText("Alpha compare")).toBeInTheDocument();
    expect(within(ledger).getByText("factor load failed")).toBeInTheDocument();
    expect(within(ledger).getByRole("link", { name: "Open runtime" })).toHaveAttribute("href", "/admin/runtime");
    expect(within(ledger).queryByText("deepseek/deepseek-chat")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Select Alpha compare"));

    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Bulk review selected" })).toHaveAttribute("href", "/admin/runtime");
  });
});
