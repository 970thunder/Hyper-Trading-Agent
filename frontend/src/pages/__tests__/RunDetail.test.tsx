import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { RunDetail } from "../RunDetail";

const apiMock = vi.hoisted(() => ({
  getRun: vi.fn(),
  getRunCode: vi.fn(),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: apiMock };
});

vi.mock("@/components/charts/CandlestickChart", () => ({
  CandlestickChart: ({ data }: { data: unknown[] }) => <div>candlestick-{data.length}</div>,
}));

vi.mock("@/components/charts/EquityChart", () => ({
  EquityChart: () => <div>equity-chart</div>,
}));

vi.mock("@/components/charts/ValidationPanel", () => ({
  ValidationPanel: () => <div>validation-panel</div>,
}));

vi.mock("@/components/chat/MetricsCard", () => ({
  MetricsCard: () => <div>metrics-summary</div>,
}));

function renderRunDetail() {
  return render(
    <MemoryRouter initialEntries={["/runs/run-001"]}>
      <Routes>
        <Route path="/runs/:runId" element={<RunDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RunDetail workspace", () => {
  beforeEach(() => {
    apiMock.getRun.mockReset();
    apiMock.getRunCode.mockReset();
    apiMock.getRunCode.mockResolvedValue({ "strategy.py": "print('ok')" });
  });

  it("shows the run workspace with floating symbol selection, artifacts, and collapsible logs", async () => {
    apiMock.getRun.mockResolvedValue({
      run_id: "run-001",
      status: "success",
      prompt: "Evaluate a momentum strategy",
      elapsed_seconds: 12.4,
      chart_symbols: ["AAPL", "MSFT"],
      price_series: {
        AAPL: [{ time: "2026-01-01", open: 10, high: 12, low: 9, close: 11, volume: 100 }],
      },
      trade_markers: [],
      trade_log: [{ time: "2026-01-01", code: "AAPL", side: "BUY", price: "10", qty: "2", reason: "signal" }],
      artifacts: [{ name: "report.html", path: "artifacts/report.html", type: "report", size: 2048, exists: true }],
      run_logs: [{ source: "backtest", line_number: 12, message: "A".repeat(280) }],
      metrics: { total_return: 0.12, sharpe: 1.4 },
    });

    const { container } = renderRunDetail();

    expect(await screen.findByText("run-001")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Evaluate a momentum strategy")).toBeInTheDocument();
    expect(container.querySelector("select")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Symbol: AAPL" }));
    expect(screen.getByRole("option", { name: "MSFT" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Artifacts" }));
    expect(screen.getByText("Artifact inventory")).toBeInTheDocument();
    expect(screen.getByText("report.html")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Logs" }));
    expect(screen.getByText("Execution logs")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand" })).toBeInTheDocument();
  });

  it("shows a concise unavailable state without API configuration instructions", async () => {
    apiMock.getRun.mockResolvedValue(null);

    renderRunDetail();

    expect(await screen.findByText("Run not found")).toBeInTheDocument();
    expect(screen.getByText("This run is unavailable or you no longer have access to it.")).toBeInTheDocument();
    expect(screen.queryByText(/API authentication key/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go back" })).toBeInTheDocument();
  });
});
