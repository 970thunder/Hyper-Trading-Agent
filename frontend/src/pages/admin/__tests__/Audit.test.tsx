import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Audit } from "@/pages/admin/Audit";

const apiMock = vi.hoisted(() => ({
  getAdminConversationAudit: vi.fn(),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: apiMock };
});

describe("Audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.getAdminConversationAudit.mockResolvedValue({
      conversations: [{
        session: { session_id: "ses_1", title: "Review earnings", status: "completed", created_at: "2026-07-17T00:00:00Z", updated_at: "2026-07-17T01:00:00Z" },
        actor: { user_id: "usr_1", email: "analyst@example.com", display_name: "Analyst" },
        messages: [
          { message_id: "msg_1", session_id: "ses_1", role: "user", content: "Review the latest earnings report", created_at: "2026-07-17T00:01:00Z", metadata: { source: "chat" } },
          { message_id: "msg_2", session_id: "ses_1", role: "assistant", content: "Revenue grew 18% year over year.", created_at: "2026-07-17T00:02:00Z" },
        ],
        usage: [{ id: "use_1", provider: "openai", model: "gpt-5", prompt_tokens: 120, completion_tokens: 80, total_tokens: 200, latency_ms: 540, estimated_cost: 0.02, session_id: "ses_1", metadata: { cached_tokens: 30 }, created_at: "2026-07-17T01:00:00Z" }],
        events: [{ id: "audit_1", action: "workspace.session.create", target_type: "session", target_id: "ses_1", user_id: "usr_1", metadata: {}, created_at: "2026-07-17T00:00:00Z" }],
        metrics: { input_tokens: 120, output_tokens: 80, total_tokens: 200, cache_tokens: 30, estimated_cost: 0.02 },
      }],
      events: [{ id: "audit_1", action: "workspace.session.create", target_type: "session", target_id: "ses_1", user_id: "usr_1", metadata: {}, created_at: "2026-07-17T00:00:00Z" }],
    });
  });

  it("opens an organization conversation with messages and token usage", async () => {
    const user = userEvent.setup();
    render(<Audit />, { wrapper: MemoryRouter });

    expect(await screen.findByText("Review earnings")).toBeInTheDocument();
    expect(screen.getByText("Analyst")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "View conversation" }));

    expect(await screen.findByText("Review the latest earnings report")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Model calls" }));
    expect(screen.getAllByText("120").length).toBeGreaterThan(1);
    expect(screen.getAllByText("80").length).toBeGreaterThan(1);
    expect(screen.getAllByText("30").length).toBeGreaterThan(1);
  });
});
