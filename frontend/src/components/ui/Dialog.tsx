import { useId, type ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton } from "@/components/ui/Button";
import { ModalLayer } from "@/components/ui/ModalLayer";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  closeLabel: string;
  children: ReactNode;
  footer?: ReactNode;
  closeOnScrim?: boolean;
  className?: string;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  children,
  footer,
  closeOnScrim = true,
  className,
}: DialogProps) {
  const generatedId = useId().replace(/:/g, "");
  const titleId = `dialog-${generatedId}-title`;
  const descriptionId = description ? `dialog-${generatedId}-description` : undefined;

  return (
    <ModalLayer
      open={open}
      onOpenChange={onOpenChange}
      kind="dialog"
      labelledBy={titleId}
      describedBy={descriptionId}
      closeOnScrim={closeOnScrim}
      className={className}
    >
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[hsl(var(--border-subtle))] px-5 py-4">
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-semibold leading-6 text-ink-strong">{title}</h2>
          {description ? <p id={descriptionId} className="mt-1 text-sm leading-5 text-ink-muted">{description}</p> : null}
        </div>
        <IconButton label={closeLabel} onClick={() => onOpenChange(false)} className="-mr-1 -mt-1">
          <X className="h-4 w-4" />
        </IconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
      {footer ? <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[hsl(var(--border-subtle))] px-5 py-3">{footer}</footer> : null}
    </ModalLayer>
  );
}
