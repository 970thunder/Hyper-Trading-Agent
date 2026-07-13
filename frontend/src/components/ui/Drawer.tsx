import { useId, type ReactNode } from "react";
import { X } from "lucide-react";
import { IconButton } from "@/components/ui/Button";
import { ModalLayer } from "@/components/ui/ModalLayer";

export interface DrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  closeLabel: string;
  side?: "left" | "right";
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  side = "right",
  children,
  footer,
  className,
}: DrawerProps) {
  const generatedId = useId().replace(/:/g, "");
  const titleId = `drawer-${generatedId}-title`;
  const descriptionId = description ? `drawer-${generatedId}-description` : undefined;

  return (
    <ModalLayer
      open={open}
      onOpenChange={onOpenChange}
      kind="drawer"
      side={side}
      labelledBy={titleId}
      describedBy={descriptionId}
      className={className}
    >
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[hsl(var(--border-subtle))] px-4 py-3">
        <div className="min-w-0">
          <h2 id={titleId} className="text-sm font-semibold leading-5 text-ink-strong">{title}</h2>
          {description ? <p id={descriptionId} className="mt-0.5 text-xs leading-4 text-ink-muted">{description}</p> : null}
        </div>
        <IconButton label={closeLabel} onClick={() => onOpenChange(false)} className="-mr-1 -mt-1">
          <X className="h-4 w-4" />
        </IconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
      {footer ? <footer className="shrink-0 border-t border-[hsl(var(--border-subtle))] p-3">{footer}</footer> : null}
    </ModalLayer>
  );
}
