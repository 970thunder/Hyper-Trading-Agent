import { fireEvent, render, screen } from "@testing-library/react";
import { KnowledgeIngestionJobs } from "../KnowledgeIngestionJobs";
import type { CommercialIngestionJob } from "@/lib/api";

const jobs: CommercialIngestionJob[] = [
  {
    id: "job-failed",
    knowledge_base_id: "kb-1",
    document_id: "doc-failed",
    status: "failed",
    progress: 42,
    error: "Parser failed",
    created_at: "2026-07-12T00:00:00Z",
    updated_at: "2026-07-12T00:01:00Z",
  },
  {
    id: "job-running",
    knowledge_base_id: "kb-1",
    document_id: "doc-running",
    status: "running",
    progress: 66,
    error: "",
    created_at: "2026-07-12T00:00:00Z",
    updated_at: "2026-07-12T00:02:00Z",
  },
];

describe("KnowledgeIngestionJobs", () => {
  it("shows lifecycle progress and exposes retry/cancel actions", () => {
    const onRetry = vi.fn();
    const onCancel = vi.fn();

    render(
      <KnowledgeIngestionJobs
        jobs={jobs}
        actionBusyId={null}
        onRetry={onRetry}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText("Recent ingestion jobs")).toBeInTheDocument();
    expect(screen.getByText("Parser failed")).toBeInTheDocument();
    expect(screen.getByText("failed · 42%")).toBeInTheDocument();
    expect(screen.getByText("running · 66%")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledWith("job-failed");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledWith("job-running");
  });
});
