import type { RunData } from "@/lib/api";

function hasItems(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function hasObjectKeys(value: unknown): boolean {
  return !!value && typeof value === "object" && Object.keys(value).length > 0;
}

export function isReportWorthyRun(run: Pick<
  RunData,
  "metrics" | "run_card" | "equity_curve" | "trade_log" | "price_series" | "trade_markers" | "validation" | "artifacts"
> | null | undefined): boolean {
  if (!run) return false;
  if (hasObjectKeys(run.metrics)) return true;
  if (hasObjectKeys(run.run_card)) return true;
  if (hasItems(run.equity_curve)) return true;
  if (hasItems(run.trade_log)) return true;
  if (hasItems(run.trade_markers)) return true;
  if (hasObjectKeys(run.validation)) return true;
  if (run.price_series && Object.values(run.price_series).some(hasItems)) return true;
  return (run.artifacts || []).some((artifact) =>
    /(?:metrics|equity|trades|positions|ohlcv|validation|strategy)\.(?:csv|json|pine|py)$/i.test(artifact.name),
  );
}

export interface BacktestMetricSummary {
  key: string;
  label: string;
  value: number;
  severity?: "good" | "warning" | "danger";
}

export interface BacktestRiskFlag {
  code: string;
  label: string;
  severity: "warning" | "danger";
}

export interface BacktestCompressedSummary {
  keyMetrics: BacktestMetricSummary[];
  equitySample: {
    total: number;
    points: Array<{ time: string; equity: number | string }>;
  };
  tradeSample: {
    total: number;
    rows: NonNullable<RunData["trade_log"]>;
  };
  validationStatus: "passed" | "failed" | "unknown";
  riskFlags: BacktestRiskFlag[];
  compressionNotes: string[];
}

export interface BacktestSummaryOptions {
  tradeSampleSize?: number;
  equitySampleSize?: number;
}

export interface BacktestSummaryInput {
  metrics?: Record<string, number>;
  equity_curve?: Array<{ time: string; equity: number | string }>;
  trade_log?: Array<Record<string, string>>;
  validation?: unknown;
}

const METRIC_LABELS: Record<string, string> = {
  total_return: "Total return",
  annual_return: "Annual return",
  sharpe: "Sharpe",
  max_drawdown: "Max drawdown",
  win_rate: "Win rate",
  trade_count: "Trades",
};

const KEY_METRIC_ORDER = [
  "total_return",
  "annual_return",
  "sharpe",
  "max_drawdown",
  "win_rate",
  "trade_count",
];

export function summarizeBacktestRun(
  run: BacktestSummaryInput | null | undefined,
  options: BacktestSummaryOptions = {},
): BacktestCompressedSummary {
  const metrics: Record<string, number> = run?.metrics || {};
  const equity = Array.isArray(run?.equity_curve) ? run.equity_curve : [];
  const trades = Array.isArray(run?.trade_log) ? run.trade_log : [];
  const equitySampleSize = Math.max(2, options.equitySampleSize ?? 40);
  const tradeSampleSize = Math.max(1, options.tradeSampleSize ?? 5);

  const keyMetrics = KEY_METRIC_ORDER
    .filter((key) => typeof metrics[key] === "number")
    .map((key) => ({
      key,
      label: METRIC_LABELS[key] || key,
      value: Number(metrics[key]),
      severity: metricSeverity(key, Number(metrics[key])),
    }));

  const equitySample = sampleEvenly(equity, equitySampleSize);
  const tradeSample = trades.slice(0, tradeSampleSize);
  const validationStatus = validationState(run?.validation);
  const riskFlags = buildRiskFlags(metrics, validationStatus);
  const compressionNotes: string[] = [];
  if (equity.length > equitySample.length) {
    compressionNotes.push(`Equity curve compressed from ${equity.length} to ${equitySample.length} points.`);
  }
  if (trades.length > tradeSample.length) {
    compressionNotes.push(`Trade log compressed from ${trades.length} to ${tradeSample.length} rows.`);
  }

  return {
    keyMetrics,
    equitySample: { total: equity.length, points: equitySample },
    tradeSample: { total: trades.length, rows: tradeSample },
    validationStatus,
    riskFlags,
    compressionNotes,
  };
}

function sampleEvenly<T>(items: T[], maxItems: number): T[] {
  if (items.length <= maxItems) return items;
  if (maxItems <= 1) return items.slice(0, 1);
  const last = items.length - 1;
  return Array.from({ length: maxItems }, (_, index) => {
    const sourceIndex = Math.round((index / (maxItems - 1)) * last);
    return items[sourceIndex];
  });
}

function metricSeverity(key: string, value: number): BacktestMetricSummary["severity"] {
  if (key === "sharpe") {
    if (value < 0.5) return "danger";
    if (value < 1) return "warning";
    return "good";
  }
  if (key === "max_drawdown") {
    if (value <= -0.35) return "danger";
    if (value <= -0.2) return "warning";
    return "good";
  }
  return undefined;
}

function validationState(validation: unknown): BacktestCompressedSummary["validationStatus"] {
  if (!validation || typeof validation !== "object") return "unknown";
  const maybe = validation as { passed?: unknown; status?: unknown };
  if (maybe.passed === true || maybe.status === "passed") return "passed";
  if (maybe.passed === false || maybe.status === "failed") return "failed";
  return "unknown";
}

function buildRiskFlags(
  metrics: Record<string, number>,
  validationStatus: BacktestCompressedSummary["validationStatus"],
): BacktestRiskFlag[] {
  const flags: BacktestRiskFlag[] = [];
  if (typeof metrics.sharpe === "number" && metrics.sharpe < 0.5) {
    flags.push({ code: "low_sharpe", label: "Sharpe below 0.5", severity: "danger" });
  }
  if (typeof metrics.max_drawdown === "number" && metrics.max_drawdown <= -0.35) {
    flags.push({ code: "deep_drawdown", label: "Max drawdown worse than -35%", severity: "danger" });
  }
  if (validationStatus === "failed") {
    flags.push({ code: "validation_failed", label: "Validation did not pass", severity: "warning" });
  }
  return flags;
}
