import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AlphaZoo } from "../AlphaZoo";

const apiMock = vi.hoisted(() => ({
  getAlpha: vi.fn(),
  createAlphaBench: vi.fn(),
  alphaBenchStreamUrl: vi.fn(),
  createAlphaCompare: vi.fn(),
  alphaCompareStreamUrl: vi.fn(),
  listAlphas: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: apiMock,
}));

vi.mock("@/lib/echarts", () => ({
  echarts: {
    init: vi.fn(() => ({
      setOption: vi.fn(),
      resize: vi.fn(),
      dispose: vi.fn(),
    })),
  },
}));

class MockEventSource {
  static instances: MockEventSource[] = [];
  listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  url: string;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  close() {}

  emit(type: string, data: unknown = {}) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(data) } as MessageEvent);
    }
  }
}

function renderAlpha(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/alpha-zoo" element={<AlphaZoo />} />
        <Route path="/alpha-zoo/bench" element={<AlphaZoo />} />
        <Route path="/alpha-zoo/compare" element={<AlphaZoo />} />
        <Route path="/alpha-zoo/:alphaId" element={<AlphaZoo />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AlphaZoo page", () => {
  beforeEach(() => {
    apiMock.getAlpha.mockReset();
    apiMock.createAlphaBench.mockReset();
    apiMock.alphaBenchStreamUrl.mockReset();
    apiMock.createAlphaCompare.mockReset();
    apiMock.alphaCompareStreamUrl.mockReset();
    apiMock.listAlphas.mockReset();
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  it("shows a professional detail summary with source, universe, and benchmark context", async () => {
    apiMock.getAlpha.mockResolvedValue({
      status: "ok",
      alpha: {
        id: "alpha101_1",
        zoo: "alpha101",
        module_path: "src/factors/alpha101.py",
        meta: {
          nickname: "Ranked volume reversal",
          theme: ["reversal", "volume"],
          universe: ["csi300"],
          frequency: "daily",
          decay_horizon: 5,
          min_warmup_bars: 30,
          requires_sector: false,
          formula_latex: "rank(ts_argmax(volume, 5))",
          notes: "Cross-sectional signal",
        },
      },
      source_code: "def alpha101_1():\n    return factor",
    });

    renderAlpha("/alpha-zoo/alpha101_1");

    expect(await screen.findByText("Alpha research brief")).toBeInTheDocument();
    expect(screen.getByText("Source module")).toBeInTheDocument();
    expect(screen.getByText("Tradable universe")).toBeInTheDocument();
    expect(screen.getByText("Benchmark setup")).toBeInTheDocument();
    expect(screen.getAllByText("src/factors/alpha101.py").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CSI 300 (China A)").length).toBeGreaterThan(0);
  });

  it("filters benchmark result tables by category", async () => {
    apiMock.createAlphaBench.mockResolvedValue({ status: "ok", job_id: "bench-1" });
    apiMock.alphaBenchStreamUrl.mockReturnValue("/alpha/bench/bench-1/stream");

    renderAlpha("/alpha-zoo/bench");
    fireEvent.click(screen.getByRole("button", { name: "Run benchmark" }));
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));

    await act(async () => {
      MockEventSource.instances[0].emit("result", {
        alive: 1,
        reversed: 1,
        dead: 1,
        skipped: 0,
        top5_by_ir: [
          { id: "alpha101_alive", ic_mean: 0.04, ir: 1.2, theme: ["momentum"], formula_latex: "a", category: "alive" },
          { id: "alpha101_reversed", ic_mean: -0.03, ir: -0.8, theme: ["reversal"], formula_latex: "b", category: "reversed" },
          { id: "alpha101_dead", ic_mean: 0.0, ir: 0.01, theme: ["volume"], formula_latex: "c", category: "dead" },
        ],
        dead_examples: [],
        by_theme: {},
      });
    });

    expect(await screen.findByText("Benchmark table controls")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Category filter"), { target: { value: "alive" } });

    const table = screen.getByRole("table", { name: "Benchmark alpha ranking" });
    expect(within(table).getByText("alpha101_alive")).toBeInTheDocument();
    expect(within(table).queryByText("alpha101_reversed")).not.toBeInTheDocument();
    expect(within(table).queryByText("alpha101_dead")).not.toBeInTheDocument();
  });

  it("filters compare rankings to the leader row", async () => {
    apiMock.createAlphaCompare.mockResolvedValue({ status: "ok", job_id: "compare-1" });
    apiMock.alphaCompareStreamUrl.mockReturnValue("/alpha/compare/compare-1/stream");

    renderAlpha("/alpha-zoo/compare?ids=alpha101_a,alpha101_b");
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));

    await act(async () => {
      MockEventSource.instances[0].emit("result", {
        universe: "csi300",
        period: "2020-2025",
        sort: "ir",
        n_compared: 2,
        n_skipped: 0,
        winner: "alpha101_a",
        ranking: [
          { rank: 1, id: "alpha101_a", zoo: "alpha101", ic_mean: 0.04, ic_std: 0.1, ir: 1.2, ic_positive_ratio: 0.58, ic_count: 240, delta_ir_vs_best: 0 },
          { rank: 2, id: "alpha101_b", zoo: "alpha101", ic_mean: 0.02, ic_std: 0.11, ir: 0.7, ic_positive_ratio: 0.52, ic_count: 240, delta_ir_vs_best: -0.5 },
        ],
        skipped: [],
      });
    });

    expect(await screen.findByText("Comparison table controls")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Ranking filter"), { target: { value: "leader" } });

    const table = screen.getByRole("table", { name: "Alpha comparison ranking" });
    expect(within(table).getByText("alpha101_a")).toBeInTheDocument();
    expect(within(table).queryByText("alpha101_b")).not.toBeInTheDocument();
  });
});
