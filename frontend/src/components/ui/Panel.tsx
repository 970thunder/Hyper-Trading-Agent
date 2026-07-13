import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type PanelSurface = "1" | "2" | "elevated";
export type PanelPadding = "none" | "sm" | "md" | "lg";

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  surface?: PanelSurface;
  padding?: PanelPadding;
  bordered?: boolean;
}

const surfaceClasses: Record<PanelSurface, string> = {
  "1": "bg-surface-1",
  "2": "bg-surface-2",
  elevated: "bg-surface-elevated shadow-sm",
};

const paddingClasses: Record<PanelPadding, string> = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-5 md:p-6",
};

export const Panel = forwardRef<HTMLDivElement, PanelProps>(function Panel(
  { surface = "1", padding = "md", bordered = true, className, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      data-surface={surface}
      className={cn(
        "rounded-lg text-ink-strong",
        bordered && "border border-[hsl(var(--border-subtle))]",
        surfaceClasses[surface],
        paddingClasses[padding],
        className,
      )}
      {...props}
    />
  );
});

export interface SectionHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  actions?: ReactNode;
  className?: string;
  titleId?: string;
}

export function SectionHeader({ title, description, eyebrow, actions, className, titleId }: SectionHeaderProps) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1 text-xs font-medium text-primary">{eyebrow}</div> : null}
        <h2 id={titleId} className="text-base font-semibold leading-6 text-ink-strong">{title}</h2>
        {description ? <p className="mt-1 max-w-3xl text-sm leading-5 text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export interface MetricProps {
  label: ReactNode;
  value: ReactNode;
  helper?: ReactNode;
  className?: string;
}

export function Metric({ label, value, helper, className }: MetricProps) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-xs leading-4 text-ink-muted">{label}</div>
      <div className="mt-1 truncate text-xl font-semibold leading-7 text-ink-strong tabular-nums" title={typeof value === "string" ? value : undefined}>
        {value}
      </div>
      {helper ? <div className="mt-0.5 truncate text-xs leading-4 text-ink-muted">{helper}</div> : null}
    </div>
  );
}
