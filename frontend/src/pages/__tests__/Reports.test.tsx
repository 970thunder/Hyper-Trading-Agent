import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Reports } from "../Reports";

const apiMock = vi.hoisted(() => ({
  listRuns: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: apiMock,
}));

describe("Reports page", () => {
  beforeEach(() => {
    apiMock.listRuns.mockReset();
  });

  it("lists backtest reports newest first with Full Report links and skips non-report runs", async () => {
    apiMock.listRuns.mockResolvedValue([
      {
        run_id: "old-report",
        status: "success",
        created_at: "2026-06-01T00:00:00Z",
        prompt: "Old report",
        codes: ["MSFT"],
        total_return: 0.05,
        sharpe: 1.1,
      },
      {
        run_id: "chat-only",
        status: "success",
        created_at: "2026-06-03T00:00:00Z",
        prompt: "No metrics",
        codes: [],
      },
      {
        run_id: "new-report",
        status: "success",
        created_at: "2026-06-04T00:00:00Z",
        prompt: "New report",
        codes: ["AAPL"],
        total_return: 0.12,
        sharpe: 1.8,
      },
    ]);

    render(<Reports />, { wrapper: MemoryRouter });

    expect(await screen.findByText("Backtest Report Library")).toBeInTheDocument();
    expect(apiMock.listRuns).toHaveBeenCalledWith(100);
    expect(screen.queryByText("chat-only")).not.toBeInTheDocument();
    const reportRunLinks = screen.getAllByRole("link", { name: /-report$/ });
    expect(reportRunLinks[0]).toHaveAttribute("href", "/runs/new-report");
    expect(reportRunLinks[1]).toHaveAttribute("href", "/runs/old-report");
    const fullReportLinks = screen.getAllByRole("link", { name: "Full Report" });
    expect(fullReportLinks[0]).toHaveAttribute("href", "/runs/new-report");
    expect(fullReportLinks[1]).toHaveAttribute("href", "/runs/old-report");
  });

  it("filters reports by search text", async () => {
    apiMock.listRuns.mockResolvedValue([
      {
        run_id: "aapl-report",
        status: "success",
        created_at: "2026-06-04T00:00:00Z",
        prompt: "Apple strategy",
        codes: ["AAPL"],
        total_return: 0.12,
      },
      {
        run_id: "msft-report",
        status: "success",
        created_at: "2026-06-03T00:00:00Z",
        prompt: "Microsoft strategy",
        codes: ["MSFT"],
        total_return: 0.08,
      },
    ]);

    render(<Reports />, { wrapper: MemoryRouter });
    await screen.findByText("aapl-report");

    fireEvent.change(screen.getByPlaceholderText("Search run id, prompt, symbol, status..."), {
      target: { value: "MSFT" },
    });

    expect(screen.queryByText("aapl-report")).not.toBeInTheDocument();
    expect(screen.getByText("msft-report")).toBeInTheDocument();
  });

  it("shows portfolio-level report analytics and distribution bars", async () => {
    apiMock.listRuns.mockResolvedValue([
      {
        run_id: "winner",
        status: "success",
        created_at: "2026-06-04T00:00:00Z",
        prompt: "Winner",
        codes: ["AAPL"],
        total_return: 0.18,
        sharpe: 2.2,
      },
      {
        run_id: "loss",
        status: "failed",
        created_at: "2026-06-03T00:00:00Z",
        prompt: "Loss",
        codes: ["MSFT"],
        total_return: -0.04,
        sharpe: -0.2,
      },
      {
        run_id: "flat",
        status: "success",
        created_at: "2026-06-02T00:00:00Z",
        prompt: "Flat",
        codes: ["GOOG"],
        total_return: 0.02,
        sharpe: 0.5,
      },
    ]);

    render(<Reports />, { wrapper: MemoryRouter });

    expect(await screen.findByText("Report analytics")).toBeInTheDocument();
    expect(screen.getByText("Total reports")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Best return")).toBeInTheDocument();
    expect(screen.getAllByText("+18.00%").length).toBeGreaterThan(0);
    expect(screen.getByText("Best Sharpe")).toBeInTheDocument();
    expect(screen.getByText("2.20")).toBeInTheDocument();
    expect(screen.getByText("Status distribution")).toBeInTheDocument();
    expect(screen.getByText("Return buckets")).toBeInTheDocument();
    expect(screen.getByText("positive")).toBeInTheDocument();
    expect(screen.getByText("negative")).toBeInTheDocument();
  });
});
