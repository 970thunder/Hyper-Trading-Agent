import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AgentPolicyPanel } from "../AgentPolicyPanel";
import type { ToolPolicy } from "@/lib/api";

const policies: ToolPolicy[] = [
  {
    tool_name: "knowledge_search",
    description: "Search organization knowledge bases.",
    is_readonly: true,
    risk_level: "low",
    permission_scope: "knowledge:read",
    requires_approval: false,
    enabled: true,
  },
];

describe("AgentPolicyPanel", () => {
  it("renders professional policy summary and tool governance actions", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const onUpdateToolPolicy = vi.fn().mockResolvedValue(undefined);

    render(
      <AgentPolicyPanel
        principal={{ user_id: "u1", organization_id: "org1", email: "owner@example.com", role: "owner" }}
        toolPolicies={policies}
        toolPolicySaving={null}
        onRefreshToolPolicies={onRefresh}
        onUpdateToolPolicy={onUpdateToolPolicy}
      />,
    );

    expect(screen.getByText("Agent Policy")).toBeInTheDocument();
    expect(screen.getByText("Professional")).toBeInTheDocument();
    expect(screen.getByText("Tool Governance")).toBeInTheDocument();
    expect(screen.getByText("knowledge_search")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    await waitFor(() => expect(onUpdateToolPolicy).toHaveBeenCalledWith(policies[0], { enabled: false }));

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });
});
