import { useEffect, useId, useRef, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { usePresence } from "@/hooks/usePresence";

type ModalKind = "dialog" | "drawer";

interface ModalLayerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: ModalKind;
  side?: "left" | "right";
  labelledBy: string;
  describedBy?: string;
  closeOnScrim?: boolean;
  className?: string;
  children: ReactNode;
}

function focusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
}

export function ModalLayer({
  open,
  onOpenChange,
  kind,
  side = "right",
  labelledBy,
  describedBy,
  closeOnScrim = true,
  className,
  children,
}: ModalLayerProps) {
  const reducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const presence = usePresence(open, { exitDuration: kind === "drawer" ? 180 : 120, reducedMotion });
  const contentRef = useRef<HTMLDivElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const previousOpenRef = useRef(open);
  const restorePendingRef = useRef(false);
  const generatedId = useId();

  if (open && !previousOpenRef.current) {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    restorePendingRef.current = false;
  } else if (!open && previousOpenRef.current) {
    restorePendingRef.current = true;
  }
  previousOpenRef.current = open;

  useEffect(() => {
    if (presence.mounted || !restorePendingRef.current) return;
    restorePendingRef.current = false;
    returnFocusRef.current?.focus();
  }, [presence.mounted]);

  useEffect(() => {
    if (!open || presence.state !== "open") return;
    const content = contentRef.current;
    if (!content) return;
    if (document.activeElement instanceof HTMLElement && content.contains(document.activeElement) && document.activeElement !== content) return;
    const focusable = focusableElements(content);
    const preferred = focusable.find((element) => (
      element.hasAttribute("data-autofocus")
      || ("autofocus" in element && Boolean((element as HTMLElement & { autofocus?: boolean }).autofocus))
    ));
    const first = preferred || focusable[0] || content;
    first.focus();
  }, [open, presence.state]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onOpenChange(false);
        return;
      }
      if (event.key !== "Tab" || !contentRef.current) return;
      const focusable = focusableElements(contentRef.current);
      if (!focusable.length) {
        event.preventDefault();
        contentRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onOpenChange, open]);

  const handleScrimPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (closeOnScrim && event.target === event.currentTarget) onOpenChange(false);
  };

  if (!presence.mounted) return null;

  const contentData = kind === "dialog"
    ? { "data-dialog-content": "" }
    : { "data-drawer-content": "", "data-side": side };

  return createPortal(
    <div
      data-dialog-scrim={kind === "dialog" ? "" : undefined}
      data-drawer-scrim={kind === "drawer" ? "" : undefined}
      data-state={presence.state}
      onPointerDown={handleScrimPointerDown}
      className={cn(
        "fixed inset-0 z-dialog bg-[hsl(var(--overlay)/0.48)]",
        kind === "dialog" ? "flex items-center justify-center p-4" : "flex p-0",
        kind === "drawer" && (side === "left" ? "justify-start" : "justify-end"),
      )}
    >
      <div
        ref={contentRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        data-state={presence.state}
        data-modal-id={generatedId}
        {...contentData}
        className={cn(
          "relative flex min-h-0 flex-col border border-border bg-surface-elevated text-ink-strong shadow-overlay outline-none",
          kind === "dialog" && "max-h-[min(46rem,calc(100vh-2rem))] w-full max-w-xl rounded-lg",
          kind === "drawer" && "h-full w-[min(22rem,calc(100vw-2rem))]",
          kind === "drawer" && side === "left" && "border-y-0 border-l-0",
          kind === "drawer" && side === "right" && "border-y-0 border-r-0",
          className,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
