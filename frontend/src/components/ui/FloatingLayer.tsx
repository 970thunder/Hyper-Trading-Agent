import {
  cloneElement,
  createRef,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { usePresence } from "@/hooks/usePresence";

export type FloatingSide = "top" | "right" | "bottom" | "left";
export type FloatingAlign = "start" | "center" | "end";

type TriggerElementProps = {
  ref?: Ref<HTMLElement>;
  onClick?: (event: ReactMouseEvent<HTMLElement>) => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLElement>) => void;
  "aria-expanded"?: boolean;
  "aria-haspopup"?: "menu" | "dialog" | "listbox" | "tree" | "grid" | boolean;
  "aria-controls"?: string;
};

export interface FloatingLayerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactElement<TriggerElementProps>;
  children: ReactNode;
  contentLabel: string;
  side?: FloatingSide;
  align?: FloatingAlign;
  offset?: number;
  collisionPadding?: number;
  matchTriggerWidth?: boolean;
  autoFocus?: "none" | "content" | "first";
  role?: "menu" | "listbox" | "dialog";
  className?: string;
  style?: CSSProperties;
}

type LayerPosition = {
  top: number;
  left: number;
  minWidth?: number;
  side: FloatingSide;
  ready: boolean;
};

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return reduced;
}

function alignedCoordinate(triggerStart: number, triggerSize: number, layerSize: number, align: FloatingAlign) {
  if (align === "end") return triggerStart + triggerSize - layerSize;
  if (align === "center") return triggerStart + (triggerSize - layerSize) / 2;
  return triggerStart;
}

function calculatePosition(
  trigger: DOMRect,
  layer: DOMRect,
  preferredSide: FloatingSide,
  align: FloatingAlign,
  offset: number,
  padding: number,
  matchTriggerWidth: boolean,
): LayerPosition {
  let side = preferredSide;
  const width = matchTriggerWidth ? Math.max(layer.width, trigger.width) : layer.width;
  const height = layer.height;

  if (side === "bottom" && trigger.bottom + offset + height > window.innerHeight - padding && trigger.top - offset - height >= padding) side = "top";
  if (side === "top" && trigger.top - offset - height < padding && trigger.bottom + offset + height <= window.innerHeight - padding) side = "bottom";
  if (side === "right" && trigger.right + offset + width > window.innerWidth - padding && trigger.left - offset - width >= padding) side = "left";
  if (side === "left" && trigger.left - offset - width < padding && trigger.right + offset + width <= window.innerWidth - padding) side = "right";

  let top = trigger.bottom + offset;
  let left = alignedCoordinate(trigger.left, trigger.width, width, align);

  if (side === "top") top = trigger.top - height - offset;
  if (side === "left" || side === "right") {
    top = alignedCoordinate(trigger.top, trigger.height, height, align);
    left = side === "left" ? trigger.left - width - offset : trigger.right + offset;
  }

  top = Math.min(Math.max(top, padding), Math.max(padding, window.innerHeight - height - padding));
  left = Math.min(Math.max(left, padding), Math.max(padding, window.innerWidth - width - padding));

  return { top, left, minWidth: matchTriggerWidth ? trigger.width : undefined, side, ready: true };
}

export function FloatingLayer({
  open,
  onOpenChange,
  trigger,
  children,
  contentLabel,
  side = "bottom",
  align = "start",
  offset = 8,
  collisionPadding = 8,
  matchTriggerWidth = false,
  autoFocus = "none",
  role = "menu",
  className,
  style,
}: FloatingLayerProps) {
  if (!isValidElement(trigger)) throw new Error("FloatingLayer requires one valid trigger element");

  const generatedId = useId();
  const contentId = `floating-${generatedId.replace(/:/g, "")}`;
  const triggerRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const fallbackRef = useMemo(() => createRef<HTMLElement>(), []);
  const reducedMotion = usePrefersReducedMotion();
  const presence = usePresence(open, { exitDuration: 90, reducedMotion });
  const modalContext = Boolean(triggerRef.current?.closest("[data-drawer-content], [data-dialog-content]"));
  const [position, setPosition] = useState<LayerPosition>({ top: -9999, left: -9999, side, ready: false });

  const updatePosition = () => {
    const triggerElement = triggerRef.current || fallbackRef.current;
    const contentElement = contentRef.current;
    if (!triggerElement || !contentElement) return;
    setPosition(calculatePosition(
      triggerElement.getBoundingClientRect(),
      contentElement.getBoundingClientRect(),
      side,
      align,
      offset,
      collisionPadding,
      matchTriggerWidth,
    ));
  };

  useLayoutEffect(() => {
    if (!presence.mounted) return;
    updatePosition();
    const handleViewportChange = () => updatePosition();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [presence.mounted, side, align, offset, collisionPadding, matchTriggerWidth]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || contentRef.current?.contains(target)) return;
      onOpenChange(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onOpenChange(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onOpenChange, open]);

  useEffect(() => {
    if (!open || presence.state !== "open" || autoFocus === "none") return;
    if (autoFocus === "content") {
      contentRef.current?.focus();
      return;
    }
    const focusable = contentRef.current?.querySelector<HTMLElement>(
      '[autofocus], button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();
  }, [autoFocus, open, presence.state]);

  const originalProps = trigger.props;
  const triggerWithBehavior = cloneElement(trigger, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node;
      fallbackRef.current = node;
      assignRef(originalProps.ref, node);
    },
    "aria-expanded": open,
    "aria-haspopup": role,
    "aria-controls": presence.mounted ? contentId : undefined,
    onClick: (event: ReactMouseEvent<HTMLElement>) => {
      originalProps.onClick?.(event);
      if (!event.defaultPrevented) onOpenChange(!open);
    },
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
      originalProps.onKeyDown?.(event);
      if (event.defaultPrevented) return;
      if (event.key === "ArrowDown" && !open) {
        event.preventDefault();
        onOpenChange(true);
      }
    },
  });

  const transformOrigin = position.side === "top"
    ? "bottom left"
    : position.side === "bottom"
      ? "top left"
      : position.side === "left"
        ? "center right"
        : "center left";

  const layer = presence.mounted ? createPortal(
    <div
      ref={contentRef}
      id={contentId}
      role={role}
      aria-label={contentLabel}
      tabIndex={-1}
      data-floating-layer
      data-state={presence.state}
      data-side={position.side}
      data-modal-context={modalContext || undefined}
      className={cn(
        "fixed z-menu max-h-[min(28rem,calc(100vh-1rem))] max-w-[calc(100vw-1rem)] overflow-auto rounded-md border border-border bg-surface-elevated p-1.5 text-ink-strong shadow-overlay outline-none",
        className,
      )}
      style={{
        ...style,
        top: position.top,
        left: position.left,
        minWidth: position.minWidth,
        visibility: position.ready ? "visible" : "hidden",
        zIndex: modalContext ? "var(--layer-modal-menu)" : undefined,
        "--floating-transform-origin": transformOrigin,
      } as CSSProperties}
    >
      {children}
    </div>,
    document.body,
  ) : null;

  return (
    <>
      {triggerWithBehavior}
      {layer}
    </>
  );
}
