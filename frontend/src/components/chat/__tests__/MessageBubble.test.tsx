import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MessageBubble } from "../MessageBubble";
import { api } from "@/lib/api";
import type { AgentMessage } from "@/types/agent";

// Mock react-markdown (heavy dependency, renders raw content in tests)
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));
vi.mock("remark-gfm", () => ({ default: () => {} }));
vi.mock("rehype-highlight", () => ({ default: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/api", () => ({
  api: {
    createFeedback: vi.fn().mockResolvedValue({ id: "fb_1" }),
  },
}));

// Mock RunCompleteCard (complex component with ECharts)
vi.mock("../RunCompleteCard", () => ({
  RunCompleteCard: ({ msg }: { msg: AgentMessage }) => (
    <div data-testid="run-complete-card">Run: {msg.runId}</div>
  ),
}));

function makeMsg(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: "msg-1",
    type: "answer",
    content: "test",
    timestamp: new Date(2024, 0, 1, 14, 30).getTime(),
    ...overrides,
  };
}

describe("MessageBubble", () => {
  describe("user messages", () => {
    it("renders user content in a styled bubble", () => {
      render(<MessageBubble msg={makeMsg({ type: "user", content: "Hello agent!" })} />);
      expect(screen.getByText("Hello agent!")).toBeInTheDocument();
    });

    it("shows timestamp", () => {
      render(<MessageBubble msg={makeMsg({ type: "user" })} />);
      expect(screen.getByText("14:30")).toBeInTheDocument();
    });
  });

  describe("answer messages", () => {
    it("renders markdown content", () => {
      render(<MessageBubble msg={makeMsg({ type: "answer", content: "Here is the **analysis**" })} />);
      expect(screen.getByTestId("markdown")).toHaveTextContent("Here is the **analysis**");
    });

    it("submits helpful feedback for answer messages", async () => {
      const user = userEvent.setup();
      const msg = makeMsg({ id: "msg-answer-1", type: "answer", runId: "run-1" });
      render(<MessageBubble msg={msg} />);

      await user.click(screen.getByLabelText("Mark as helpful"));

      expect(api.createFeedback).toHaveBeenCalledWith({
        target_type: "message",
        target_id: "msg-answer-1",
        run_id: "run-1",
        rating: 1,
        tags: ["helpful"],
        metadata: { message_type: "answer" },
      });
    });

    it("shows expandable citation snippets for RAG-backed answers", async () => {
      const user = userEvent.setup();
      render(
        <MessageBubble
          msg={makeMsg({
            type: "answer",
            content: "The portfolio policy requires a drawdown review.",
            citations: [
              {
                documentId: "doc-1",
                chunkId: "chunk-1",
                title: "Risk Policy",
                sourceUri: "uploads/risk.md",
                citation: "Risk Policy (uploads/risk.md)#chunk-1",
                text: "Portfolios with drawdowns over 10% require committee review before capital is increased.",
                score: 0.91,
              },
            ],
          })}
        />,
      );

      expect(screen.getByText("Sources")).toBeInTheDocument();
      expect(screen.queryByText(/Portfolios with drawdowns/)).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /Risk Policy/ }));

      expect(screen.getByText(/Portfolios with drawdowns/)).toBeInTheDocument();
      expect(screen.getByText("uploads/risk.md")).toBeInTheDocument();
    });
  });

  describe("error messages", () => {
    it("renders error content with danger styling", () => {
      render(<MessageBubble msg={makeMsg({ type: "error", content: "Execution failed" })} />);
      expect(screen.getByText("Execution failed")).toBeInTheDocument();
    });

    it("shows retry button when onRetry is provided", () => {
      const onRetry = vi.fn();
      render(<MessageBubble msg={makeMsg({ type: "error", content: "Something broke" })} onRetry={onRetry} />);
      expect(screen.getByRole("button")).toBeInTheDocument();
    });

    it("calls onRetry when retry button is clicked", async () => {
      const onRetry = vi.fn();
      const msg = makeMsg({ type: "error", content: "Something broke" });
      render(<MessageBubble msg={msg} onRetry={onRetry} />);

      const user = userEvent.setup();
      await user.click(screen.getByRole("button"));
      expect(onRetry).toHaveBeenCalledWith(msg);
    });

    it("shows timeout hint for timeout errors", () => {
      render(
        <MessageBubble
          msg={makeMsg({ type: "error", content: "Execution timed out after 600s" })}
          onRetry={vi.fn()}
        />,
      );
      expect(screen.getByText(/Try simplifying the strategy/)).toBeInTheDocument();
    });
  });

  describe("run_complete messages", () => {
    it("renders RunCompleteCard when runId is present", () => {
      render(<MessageBubble msg={makeMsg({ type: "run_complete", runId: "run-42" })} />);
      expect(screen.getByTestId("run-complete-card")).toBeInTheDocument();
      expect(screen.getByText("Run: run-42")).toBeInTheDocument();
    });
  });

  describe("fallback", () => {
    it("renders content for unknown message types", () => {
      render(<MessageBubble msg={makeMsg({ type: "thinking", content: "analyzing data..." })} />);
      expect(screen.getByText("analyzing data...")).toBeInTheDocument();
    });

    it("renders null for empty content on unknown types", () => {
      const { container } = render(<MessageBubble msg={makeMsg({ type: "thinking", content: "" })} />);
      expect(container.innerHTML).toBe("");
    });
  });
});
