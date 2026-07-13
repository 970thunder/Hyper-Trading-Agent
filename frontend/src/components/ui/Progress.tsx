import { cn } from "@/lib/utils";

export interface ProgressProps {
  value?: number;
  label: string;
  showValue?: boolean;
  indeterminate?: boolean;
  className?: string;
}

export function Progress({ value = 0, label, showValue = false, indeterminate = false, className }: ProgressProps) {
  const normalized = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));

  return (
    <div className={cn("grid min-w-0 gap-1.5", className)}>
      {showValue ? (
        <div className="flex items-center justify-between gap-3 text-xs leading-4">
          <span className="truncate text-ink-muted">{label}</span>
          <span className="shrink-0 font-mono text-ink-strong tabular-nums">{Math.round(normalized)}%</span>
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={indeterminate ? undefined : 0}
        aria-valuemax={indeterminate ? undefined : 100}
        aria-valuenow={indeterminate ? undefined : normalized}
        className="h-1.5 overflow-hidden rounded-full bg-surface-3"
      >
        {indeterminate ? (
          <div
            data-progress-fill
            data-indeterminate="true"
            className="h-full w-1/3 rounded-full bg-primary [animation:pulse-slide_1.8s_var(--ease-standard)_infinite]"
          />
        ) : (
          <div data-progress-fill className="h-full rounded-full bg-primary" style={{ width: `${normalized}%` }} />
        )}
      </div>
      {!showValue ? <span className="sr-only">{label}</span> : null}
    </div>
  );
}
