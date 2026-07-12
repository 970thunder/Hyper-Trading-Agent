import { act, fireEvent, render, screen } from "@testing-library/react";
import { Runtime } from "../Runtime";
import type { LiveStatus } from "@/lib/api";

const apiMock = vi.hoisted(() => ({
  getLiveStatus: vi.fn(),
  listRuntimeJobs: vi.fn(),
  retryRuntimeJob: vi.fn(),
  cancelRuntimeJob: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: apiMock,
}));

function makeStatus(overrides: Partial<LiveStatus> = {}): LiveStatus {
  return {
    global_halted: false,
    brokers: [
      {
        auth: {
          broker: "paper",
          oauth_token_present: true,
          is_live_broker: true,
        },
        runner: {
          broker: "paper",
          alive: true,
          last_tick: null,
          last_tick_age_seconds: 5,
        },
        mandate: {
          broker: "paper",
          account_ref: "acct-1",
          created_at: "2026-06-12T00:00:00Z",
          expires_at: "2999-01-01T00:00:00Z",
          expires_in_seconds: 3600,
          expired: false,
          limits: {
            max_order_notional_usd: 750,
            max_total_exposure_usd: 2000,
            max_leverage: 1,
            max_trades_per_day: 4,
            allowed_instruments: ["equity"],
            account_funding_usd: 10000,
          },
        },
        halted: false,
      },
      {
        auth: {
          broker: "sandbox",
          oauth_token_present: false,
          is_live_broker: true,
        },
        runner: {
          broker: "sandbox",
          alive: false,
          last_tick: null,
          last_tick_age_seconds: null,
        },
        mandate: null,
        halted: false,
      },
    ],
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("Runtime page", () => {
  beforeEach(() => {
    apiMock.getLiveStatus.mockReset();
    apiMock.listRuntimeJobs.mockReset();
    apiMock.retryRuntimeJob.mockReset();
    apiMock.cancelRuntimeJob.mockReset();
    apiMock.listRuntimeJobs.mockResolvedValue([]);
  });

  it("renders broker auth, runner, mandate, and risk state from live status", async () => {
    apiMock.getLiveStatus.mockResolvedValue(makeStatus());

    render(<Runtime />);

    expect(await screen.findByText("Live / Paper Runtime Status")).toBeInTheDocument();
    expect(screen.getByText("Clear")).toBeInTheDocument();
    expect(screen.getByText("paper")).toBeInTheDocument();
    expect(screen.getByText("auth present")).toBeInTheDocument();
    expect(screen.getByText("runner alive")).toBeInTheDocument();
    expect(screen.getByText("runtime active")).toBeInTheDocument();
    expect(screen.getByText("acct-1")).toBeInTheDocument();
    expect(screen.getByText(/\$750\/order/)).toBeInTheDocument();
    expect(screen.getByText("sandbox")).toBeInTheDocument();
    expect(screen.getByText("auth missing")).toBeInTheDocument();
    expect(screen.getByText("dormant")).toBeInTheDocument();
  });

  it("fails closed when live status is unavailable", async () => {
    apiMock.getLiveStatus.mockRejectedValue(new Error("backend offline"));

    render(<Runtime />);

    expect(await screen.findByText("Runtime status unavailable")).toBeInTheDocument();
    expect(screen.getByText("backend offline")).toBeInTheDocument();
    expect(screen.getByText(/Treat connector runtime as unavailable/)).toBeInTheDocument();
  });

  it("refreshes by reading live status again", async () => {
    apiMock.getLiveStatus.mockResolvedValue(makeStatus());

    render(<Runtime />);
    await screen.findByText("paper");

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(apiMock.getLiveStatus).toHaveBeenCalledTimes(2);
  });

  it("keeps the newest live status when an older request resolves later", async () => {
    const first = deferred<LiveStatus>();
    const second = deferred<LiveStatus>();
    apiMock.getLiveStatus
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    render(<Runtime />);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await act(async () => {
      second.resolve(makeStatus({ global_halted: true, brokers: [] }));
      await second.promise;
    });
    expect(await screen.findByText("Halted")).toBeInTheDocument();

    await act(async () => {
      first.resolve(makeStatus());
      await first.promise;
    });

    expect(screen.getByText("Halted")).toBeInTheDocument();
    expect(screen.queryByText("paper")).not.toBeInTheDocument();
  });

  it("aborts an in-flight status request on unmount", () => {
    const pending = deferred<LiveStatus>();
    apiMock.getLiveStatus.mockReturnValue(pending.promise);

    const { unmount } = render(<Runtime />);
    const signal = apiMock.getLiveStatus.mock.calls[0][0] as AbortSignal;

    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);

    unmount();

    expect(signal.aborted).toBe(true);
  });

  it("renders sub-minute mandate expiry as seconds", async () => {
    const baseStatus = makeStatus();
    const expiresAt = new Date(Date.now() + 45_000).toISOString();
    apiMock.getLiveStatus.mockResolvedValue(makeStatus({
      brokers: [
        {
          ...baseStatus.brokers[0],
          mandate: {
            ...baseStatus.brokers[0].mandate!,
            expires_at: expiresAt,
          },
        },
      ],
    }));

    render(<Runtime />);

    expect(await screen.findByText("45s")).toBeInTheDocument();
  });

  it("renders runtime job queue state and exposes retry and cancel actions", async () => {
    apiMock.getLiveStatus.mockResolvedValue(makeStatus());
    apiMock.listRuntimeJobs.mockResolvedValue([
      {
        job_id: "bench-1",
        kind: "alpha_bench",
        title: "Alpha bench csi300",
        status: "running",
        progress: 40,
        error: "",
        created_at: "2026-07-12T00:00:00Z",
        updated_at: "2026-07-12T00:02:00Z",
      },
      {
        job_id: "compare-1",
        kind: "alpha_compare",
        title: "Alpha compare",
        status: "failed",
        progress: 100,
        error: "factor load failed",
        created_at: "2026-07-12T00:00:00Z",
        updated_at: "2026-07-12T00:03:00Z",
      },
    ]);
    apiMock.retryRuntimeJob.mockResolvedValue({ status: "queued", job_id: "compare-1" });
    apiMock.cancelRuntimeJob.mockResolvedValue({ status: "cancelled", job_id: "bench-1" });

    render(<Runtime />);

    expect(await screen.findByText("Background jobs")).toBeInTheDocument();
    expect(screen.getByText("2 jobs")).toBeInTheDocument();
    expect(screen.getAllByText("1 running").length).toBeGreaterThan(0);
    expect(screen.getByText("1 failed")).toBeInTheDocument();
    expect(screen.getByText("Alpha bench csi300")).toBeInTheDocument();
    expect(screen.getByText("factor load failed")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel job" }));
    expect(apiMock.cancelRuntimeJob).toHaveBeenCalledWith("bench-1");

    fireEvent.click(screen.getByRole("button", { name: "Retry job" }));
    expect(apiMock.retryRuntimeJob).toHaveBeenCalledWith("compare-1");
  });
});
