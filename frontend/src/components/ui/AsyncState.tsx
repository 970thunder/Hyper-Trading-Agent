import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  label?: string;
  className?: string;
}

function cssSize(value: number | string | undefined) {
  return typeof value === "number" ? `${value}px` : value;
}

export function Skeleton({ width, height, label = "Loading", className }: SkeletonProps) {
  return (
    <div
      role="status"
      aria-label={label}
      className={cn("rounded-md bg-surface-2 [animation:skeleton-pulse_1.6s_var(--ease-standard)_infinite]", className)}
      style={{ width: cssSize(width), height: cssSize(height) }}
    />
  );
}

export interface EmptyStateProps {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export function EmptyState({ title, description, actionLabel, onAction, className }: EmptyStateProps) {
  return (
    <div className={cn("flex min-h-40 flex-col items-center justify-center px-6 py-8 text-center", className)}>
      <h3 className="text-sm font-semibold text-ink-strong">{title}</h3>
      {description ? <p className="mt-1 max-w-md text-sm leading-5 text-ink-muted">{description}</p> : null}
      {actionLabel && onAction ? (
        <Button variant="primary" size="sm" className="mt-4" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

export interface InlineErrorProps {
  title: string;
  message?: string;
  retryLabel?: string;
  onRetry?: () => void;
  className?: string;
}

export function InlineError({ title, message, retryLabel, onRetry, className }: InlineErrorProps) {
  return (
    <div role="alert" className={cn("flex items-start gap-3 rounded-md border border-danger/25 bg-danger/5 p-3", className)}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink-strong">{title}</p>
        {message ? <p className="mt-0.5 break-words text-xs leading-4 text-ink-muted">{message}</p> : null}
      </div>
      {retryLabel && onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}

export function RefreshingOverlay({ label, className }: { label: string; className?: string }) {
  return (
    <div role="status" className={cn("inline-flex items-center gap-2 text-xs text-ink-muted", className)}>
      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
