import { cn } from "@/lib/utils";

export type StatusTone = "neutral" | "primary" | "info" | "success" | "warning" | "danger";

const toneClasses: Record<StatusTone, string> = {
  neutral: "border-border bg-surface-2 text-ink-muted",
  primary: "border-primary/25 bg-primary/10 text-primary",
  info: "border-info/25 bg-info/10 text-info",
  success: "border-success/25 bg-success/10 text-success",
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-danger/30 bg-danger/10 text-danger",
};

const dotClasses: Record<StatusTone, string> = {
  neutral: "bg-ink-disabled",
  primary: "bg-primary",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

export function StatusIndicator({
  label,
  tone = "neutral",
  dot = false,
  className,
}: {
  label: string;
  tone?: StatusTone;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      data-tone={tone}
      className={cn("inline-flex min-h-5 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium leading-4", toneClasses[tone], className)}
    >
      {dot ? <span data-status-dot className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClasses[tone])} aria-hidden="true" /> : null}
      <span className="truncate">{label}</span>
    </span>
  );
}
