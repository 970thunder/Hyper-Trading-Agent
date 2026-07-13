import {
  createContext,
  useContext,
  useId,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

type TabsContextValue = {
  value: string;
  onValueChange: (value: string) => void;
  rootId: string;
};

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext() {
  const context = useContext(TabsContext);
  if (!context) throw new Error("Tab components must be rendered inside Tabs");
  return context;
}

function idPart(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function Tabs({ value, onValueChange, children, className }: { value: string; onValueChange: (value: string) => void; children: ReactNode; className?: string }) {
  const generatedId = useId();
  const rootId = `tabs-${generatedId.replace(/:/g, "")}`;
  return (
    <TabsContext.Provider value={{ value, onValueChange, rootId }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export interface TabListProps extends HTMLAttributes<HTMLDivElement> {
  orientation?: "horizontal" | "vertical";
}

export function TabList({ orientation = "horizontal", className, onKeyDown, ...props }: TabListProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;
    const forward = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
    const backward = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
    if (![forward, backward, "Home", "End"].includes(event.key)) return;

    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'));
    if (!tabs.length) return;
    const currentIndex = Math.max(0, tabs.indexOf(document.activeElement as HTMLButtonElement));
    let nextIndex = currentIndex;
    if (event.key === forward) nextIndex = (currentIndex + 1) % tabs.length;
    if (event.key === backward) nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    event.preventDefault();
    tabs[nextIndex].focus();
    tabs[nextIndex].click();
  };

  return (
    <div
      role="tablist"
      aria-orientation={orientation}
      onKeyDown={handleKeyDown}
      className={cn(
        "flex min-w-0 gap-1 rounded-lg border border-[hsl(var(--border-subtle))] bg-surface-2 p-1",
        orientation === "horizontal" ? "flex-wrap items-center" : "flex-col",
        className,
      )}
      {...props}
    />
  );
}

export interface TabProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "value"> {
  value: string;
}

export function Tab({ value, disabled, className, children, onClick, ...props }: TabProps) {
  const context = useTabsContext();
  const active = context.value === value;
  const key = idPart(value);
  return (
    <button
      type="button"
      role="tab"
      id={`${context.rootId}-tab-${key}`}
      aria-controls={`${context.rootId}-panel-${key}`}
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      disabled={disabled}
      data-state={active ? "active" : "inactive"}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented && !disabled) context.onValueChange(value);
      }}
      className={cn(
        "inline-flex min-h-8 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
        "transition-[color,background-color,box-shadow] duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
        active ? "bg-surface-1 text-primary shadow-xs" : "text-ink-muted hover:bg-surface-1/70 hover:text-ink-strong",
        "disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export interface TabPanelProps extends HTMLAttributes<HTMLDivElement> {
  value: string;
}

export function TabPanel({ value, className, ...props }: TabPanelProps) {
  const context = useTabsContext();
  const active = context.value === value;
  const key = idPart(value);
  return (
    <div
      role="tabpanel"
      id={`${context.rootId}-panel-${key}`}
      aria-labelledby={`${context.rootId}-tab-${key}`}
      tabIndex={0}
      hidden={!active}
      data-state={active ? "active" : "inactive"}
      className={cn("focus-visible:outline-none", active && "animate-[page-enter_var(--duration-base)_var(--ease-emphasized)_both]", className)}
      {...props}
    />
  );
}
