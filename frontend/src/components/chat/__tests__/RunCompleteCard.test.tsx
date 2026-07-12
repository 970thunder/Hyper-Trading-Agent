import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RunCompleteCard } from "../RunCompleteCard";
import { api } from "@/lib/api";
import type { AgentMessage } from "@/types/agent";

vi.mock("@/components/charts/MiniEquityChart", () => ({
  MiniEquityChart: () => <div data-testid="mini-equity-chart" />,
}));
vi.mock("../MetricsCard", () => ({
  MetricsCard: () => <div data-testid="metrics-card" />,
}));
vi.mock("../PineScriptViewer", () => ({
  PineScriptViewer: () => <div data-testid="pine-script-viewer" />,
}));
vi.mock("@/lib/api", () => ({
  api: {
    getRun: vi.fn(),
    getRunPine: vi.fn().mockResolvedValue({ exists: false }),
  },
}));

function makeMsg(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: "run-msg",
    type: "run_complete",
    content: "",
    timestamp: Date.now(),
    runId: "run-1",
    metrics: {
      total_return: 0.18,
      annual_return: 0.09,
      sharpe: 0.42,
      max_drawdown: -0.38,
      win_rate: 0.51,
      trade_count: 120,
    },
    ...overrides,
  };
}

describe("RunCompleteCard", () => {
  it("shows compressed backtest summary for long equity and trade payloads", async () => {
    vi.mocked(api.getRun).mockResolvedValue({
      status: "success",
      run_id: "run-1",
      metrics: makeMsg().metrics,
      equity_curve: Array.from({ length: 80 }, (_, index) => ({
        time: `2024-01-${String((index % 30) + 1).padStart(2, "0")}`,
        equity: 100000 + index * 100,
      })),
      trade_log: Array.from({ length: 25 }, (_, index) => ({
        date: `2024-02-${String((index % 28) + 1).padStart(2, "0")}`,
        action: index % 2 ? "SELL" : "BUY",
      })),
      validation: { passed: false },
    });

    render(
      <MemoryRouter>
        <RunCompleteCard msg={makeMsg()} />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Compressed backtest summary")).toBeInTheDocument();
    expect(screen.getByText("Validation needs review")).toBeInTheDocument();
    expect(screen.getByText("Equity: 40 / 80 points shown")).toBeInTheDocument();
    expect(screen.getByText("Trades: 5 / 25 rows shown")).toBeInTheDocument();
    expect(screen.getByText("Sharpe below 0.5")).toBeInTheDocument();
    expect(screen.getByText("Max drawdown worse than -35%")).toBeInTheDocument();
  });
});
