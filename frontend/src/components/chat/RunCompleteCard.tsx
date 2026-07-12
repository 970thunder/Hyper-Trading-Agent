import { useTranslation } from 'react-i18next';
import { memo, useEffect, useMemo, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { BarChart3, Code2, FileText, Loader2, ShieldAlert } from "lucide-react";
import { api } from "@/lib/api";
import { summarizeBacktestRun } from "@/lib/runReports";
import { AgentAvatar } from "./AgentAvatar";
import { MetricsCard } from "./MetricsCard";
import { MiniEquityChart } from "@/components/charts/MiniEquityChart";
import { PineScriptViewer } from "./PineScriptViewer";
import type { AgentMessage } from "@/types/agent";
import type { RunData } from "@/lib/api";

interface Props {
  msg: AgentMessage;
}

export const RunCompleteCard = memo(function RunCompleteCard({ msg }: Props) {
  const { t } = useTranslation();
  const [curve, setCurve] = useState(msg.equityCurve);
  const [pineCode, setPineCode] = useState<string | null>(null);
  const [pineLoading, setPineLoading] = useState(false);
  const [showPine, setShowPine] = useState(false);
  const [pineChecked, setPineChecked] = useState(false);
  const [pineExists, setPineExists] = useState(false);
  const [runData, setRunData] = useState<RunData | null>(null);

  useEffect(() => {
    if (msg.runId && !runData) {
      api.getRun(msg.runId).then(r => {
        setRunData(r);
        if (r.equity_curve) setCurve(r.equity_curve.map(e => ({ time: e.time, equity: e.equity })));
      }).catch(() => {});
    }
  }, [msg.runId, runData]);

  const compressedSummary = useMemo(() => summarizeBacktestRun(
    runData || {
      metrics: msg.metrics,
      equity_curve: msg.equityCurve,
      trade_log: undefined,
      validation: undefined,
    },
    { tradeSampleSize: 5, equitySampleSize: 40 },
  ), [runData, msg.metrics, msg.equityCurve]);

  const validationLabel = compressedSummary.validationStatus === "passed"
    ? t("runComplete.validationPassed")
    : compressedSummary.validationStatus === "failed"
      ? t("runComplete.validationFailed")
      : t("runComplete.validationUnknown");

  // Check if Pine Script exists for this run (skip for shadow-only cards with no runId)
  useEffect(() => {
    if (!msg.runId) {
      setPineChecked(true);
      return;
    }
    if (!pineChecked) {
      api.getRunPine(msg.runId).then(r => {
        setPineChecked(true);
        if (r.exists && r.content) {
          setPineExists(true);
          setPineCode(r.content);
        }
      }).catch(() => { setPineChecked(true); });
    }
  }, [msg.runId, pineChecked]);

  const handlePineClick = useCallback(async () => {
    if (pineCode) {
      setShowPine(true);
      return;
    }
    if (!msg.runId) return;
    setPineLoading(true);
    try {
      const r = await api.getRunPine(msg.runId);
      if (r.exists && r.content) {
        setPineCode(r.content);
        setPineExists(true);
        setShowPine(true);
      }
    } catch { /* ignore */ }
    finally { setPineLoading(false); }
  }, [pineCode, msg.runId]);

  return (
    <div className="flex gap-3">
      <AgentAvatar />
      <div className="flex-1 min-w-0 space-y-2">
        {msg.metrics && Object.keys(msg.metrics).length > 0 && (
          <MetricsCard metrics={msg.metrics} compact />
        )}
        {curve && curve.length > 1 && (
          <MiniEquityChart data={curve} height={80} />
        )}
        {(compressedSummary.compressionNotes.length > 0 || compressedSummary.riskFlags.length > 0 || compressedSummary.validationStatus !== "unknown") && (
          <div className="rounded-lg border border-border/70 bg-muted/25 px-3 py-2 text-xs text-muted-foreground shadow-sm">
            <div className="mb-1.5 flex items-center gap-2 font-medium text-foreground">
              <BarChart3 className="h-3.5 w-3.5 text-primary" />
              {t("runComplete.compressedSummary")}
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-md border border-border/70 bg-background/70 px-2 py-1">{validationLabel}</span>
              {compressedSummary.equitySample.total > compressedSummary.equitySample.points.length && (
                <span className="rounded-md border border-border/70 bg-background/70 px-2 py-1">
                  {t("runComplete.equitySample", { shown: compressedSummary.equitySample.points.length, total: compressedSummary.equitySample.total })}
                </span>
              )}
              {compressedSummary.tradeSample.total > compressedSummary.tradeSample.rows.length && (
                <span className="rounded-md border border-border/70 bg-background/70 px-2 py-1">
                  {t("runComplete.tradeSample", { shown: compressedSummary.tradeSample.rows.length, total: compressedSummary.tradeSample.total })}
                </span>
              )}
              {compressedSummary.riskFlags.map((flag) => (
                <span
                  key={flag.code}
                  className="inline-flex items-center gap-1 rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-warning"
                >
                  <ShieldAlert className="h-3 w-3" />
                  {flag.label}
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-center gap-3 flex-wrap">
          {msg.runId && (
            <Link
              to={`/runs/${msg.runId}`}
              className="text-sm text-primary hover:underline inline-flex items-center gap-1.5 font-medium"
            >
              <BarChart3 className="h-3.5 w-3.5" />
              {t("runComplete.fullReport")}
            </Link>
          )}
          {pineExists && (
            <button
              onClick={handlePineClick}
              disabled={pineLoading}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-success hover:underline disabled:opacity-50"
            >
              {pineLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Code2 className="h-3.5 w-3.5" />}
              Pine Script
            </button>
          )}
          {msg.shadowId && (
            <a
              href={`/shadow-reports/${encodeURIComponent(msg.shadowId)}?format=html`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-info hover:underline"
            >
              <FileText className="h-3.5 w-3.5" />
              Shadow Report
            </a>
          )}
        </div>
        {showPine && pineCode && (
          <PineScriptViewer code={pineCode} onClose={() => setShowPine(false)} />
        )}
      </div>
    </div>
  );
});
