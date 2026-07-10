import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Brain,
  CheckCircle2,
  Clock3,
  Database,
  FileText,
  Loader2,
  Search,
  Sparkles,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { localizeToolName } from "@/lib/tools";
import type { ToolCallEntry } from "@/types/agent";

interface Props {
  toolCalls: ToolCallEntry[];
  reasoningActive?: boolean;
  reasoningChars?: number;
  startedAt?: number | null;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

function toolKind(tool: string): "rag" | "skill" | "document" | "search" | "tool" {
  const normalized = tool.toLowerCase();
  if (normalized.includes("knowledge") || normalized.includes("rag") || normalized.includes("kb")) return "rag";
  if (normalized.includes("skill")) return "skill";
  if (normalized.includes("document") || normalized.includes("read_file") || normalized.includes("read_url")) return "document";
  if (normalized.includes("search") || normalized.includes("news") || normalized.includes("research")) return "search";
  return "tool";
}

function ToolIcon({ tool, status }: { tool: string; status: ToolCallEntry["status"] }) {
  if (status === "running") return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
  if (status === "error") return <XCircle className="h-3.5 w-3.5 text-destructive" />;
  const kind = toolKind(tool);
  if (kind === "rag") return <Database className="h-3.5 w-3.5 text-accent" />;
  if (kind === "skill") return <Sparkles className="h-3.5 w-3.5 text-primary" />;
  if (kind === "document") return <FileText className="h-3.5 w-3.5 text-info" />;
  if (kind === "search") return <Search className="h-3.5 w-3.5 text-accent" />;
  return <CheckCircle2 className="h-3.5 w-3.5 text-success" />;
}

function summarizeArgs(args: Record<string, string>): string {
  const entries = Object.entries(args).filter(([, value]) => value !== undefined && value !== "");
  if (entries.length === 0) return "";
  return entries
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${String(value).replace(/\s+/g, " ").slice(0, 80)}`)
    .join(" | ");
}

function statusLabel(status: ToolCallEntry["status"], t: any): string {
  if (status === "running") return String(t("executionTrace.running"));
  if (status === "error") return String(t("executionTrace.failed"));
  return String(t("executionTrace.done"));
}

export function AgentExecutionTrace({
  toolCalls,
  reasoningActive = false,
  reasoningChars = 0,
  startedAt = null,
}: Props) {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!reasoningActive && !toolCalls.some((item) => item.status === "running")) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [reasoningActive, toolCalls]);

  const elapsedTotal = startedAt ? formatDuration(now - startedAt) : "";
  const hasActivity = reasoningActive || reasoningChars > 0 || toolCalls.length > 0;

  const summary = useMemo(() => {
    const running = toolCalls.filter((item) => item.status === "running").length;
    const failed = toolCalls.filter((item) => item.status === "error").length;
    if (running > 0) return t("executionTrace.runningSummary", { running, total: toolCalls.length });
    if (failed > 0) return t("executionTrace.failedSummary", { failed, total: toolCalls.length });
    if (toolCalls.length > 0) return t("executionTrace.doneSummary", { total: toolCalls.length });
    return t("executionTrace.reasoning");
  }, [t, toolCalls]);

  if (!hasActivity) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{summary}</span>
        {elapsedTotal && (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-mono text-[10px]">
            <Clock3 className="h-3 w-3" />
            {elapsedTotal}
          </span>
        )}
      </div>

      {(reasoningActive || reasoningChars > 0) && (
        <div className="flex gap-2 rounded-lg border border-border/55 bg-background/80 px-2.5 py-2 text-xs shadow-sm transition-colors hover:border-primary/30">
          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            {reasoningActive ? <Loader2 className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] text-muted-foreground">{t("executionTrace.step", { index: 1 })}</span>
              <span className="font-medium text-foreground">{t("executionTrace.reasoning")}</span>
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {reasoningActive ? t("executionTrace.running") : t("executionTrace.done")}
              </span>
              {reasoningChars > 0 && (
                <span className="font-mono text-[10px] text-muted-foreground">
                  {t("executionTrace.reasoningChars", { count: reasoningChars })}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {toolCalls.map((entry, index) => {
        const progress = entry.progress;
        const argsSummary = summarizeArgs(entry.arguments);
        const elapsed = entry.status === "running"
          ? (entry.elapsed_s != null ? `${entry.elapsed_s.toFixed(0)}s` : formatDuration(now - entry.timestamp))
          : (entry.elapsed_ms != null ? formatDuration(entry.elapsed_ms) : "");
        const kind = toolKind(entry.tool);
        const stepNumber = index + (reasoningActive || reasoningChars > 0 ? 2 : 1);
        return (
          <div key={entry.id} className="flex gap-2 rounded-lg border border-border/55 bg-background/80 px-2.5 py-2 text-xs shadow-sm transition-colors hover:border-primary/30">
            <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-muted">
              <ToolIcon tool={entry.tool} status={entry.status} />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px] text-muted-foreground">{t("executionTrace.step", { index: stepNumber })}</span>
                <span className="font-medium text-foreground">{localizeToolName(entry.tool)}</span>
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {t(`executionTrace.kind.${kind}`)}
                </span>
                <span className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px]",
                  entry.status === "running" && "bg-primary/10 text-primary",
                  entry.status === "ok" && "bg-success/10 text-success",
                  entry.status === "error" && "bg-danger/10 text-danger",
                )}>
                  {statusLabel(entry.status, t)}
                </span>
                {elapsed && <span className="font-mono text-[10px] text-muted-foreground">{elapsed}</span>}
              </div>

              {argsSummary && (
                <div className="truncate font-mono text-[10px] text-muted-foreground">
                  {t("executionTrace.args")} {argsSummary}
                </div>
              )}

              {(progress?.stage || progress?.message || progress?.total) && (
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                  {progress.stage && <span>{progress.stage}</span>}
                  {progress.current != null && progress.total != null && progress.total > 0 && (
                    <span className="font-mono">{progress.current}/{progress.total}</span>
                  )}
                  {progress.message && <span className="min-w-0 truncate">{progress.message}</span>}
                </div>
              )}

              {entry.preview && (
                <div className="line-clamp-2 rounded-md bg-muted/40 px-2 py-1 font-mono text-[10px] leading-relaxed text-muted-foreground">
                  {entry.preview}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
