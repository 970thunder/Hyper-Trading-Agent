import { render, screen } from "@testing-library/react";
import { AgentExecutionTrace } from "../AgentExecutionTrace";
import type { ToolCallEntry } from "@/types/agent";

function toolCall(overrides: Partial<ToolCallEntry> = {}): ToolCallEntry {
  return {
    id: "tool-1",
    tool: "knowledge_search",
    arguments: { query: "risk" },
    status: "running",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("AgentExecutionTrace", () => {
  it("shows layered streaming status for planning, tools, and drafting", () => {
    render(
      <AgentExecutionTrace
        toolCalls={[toolCall()]}
        reasoningActive
        reasoningChars={42}
        startedAt={Date.now() - 1500}
        plan={[
          {
            step_id: "plan",
            title: "Build plan",
            type: "planning",
            status: "running",
            dependencies: [],
            tool_names: [],
            started_at: null,
            completed_at: null,
            elapsed_ms: null,
          },
        ]}
        attemptStatus="running"
        outputActive
      />
    );

    expect(screen.getByText("Planning")).toBeInTheDocument();
    expect(screen.getByText("Tools")).toBeInTheDocument();
    expect(screen.getByText("Drafting")).toBeInTheDocument();
    expect(screen.getAllByText("1").length).toBeGreaterThanOrEqual(3);
  });
});
