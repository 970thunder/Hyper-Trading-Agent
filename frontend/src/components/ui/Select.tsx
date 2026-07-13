import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { FloatingLayer, type FloatingAlign, type FloatingSide } from "@/components/ui/FloatingLayer";

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  badge?: string;
  disabled?: boolean;
}

export interface SelectProps {
  value?: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  label: string;
  placeholder?: string;
  disabled?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyLabel?: string;
  side?: FloatingSide;
  align?: FloatingAlign;
  className?: string;
  contentClassName?: string;
}

function nextEnabledIndex(options: SelectOption[], current: number, direction: 1 | -1) {
  if (!options.length) return -1;
  for (let step = 1; step <= options.length; step += 1) {
    const index = (current + direction * step + options.length) % options.length;
    if (!options[index].disabled) return index;
  }
  return current;
}

export function Select({
  value,
  onValueChange,
  options,
  label,
  placeholder,
  disabled = false,
  searchable = false,
  searchPlaceholder,
  emptyLabel = "No options",
  side = "bottom",
  align = "start",
  className,
  contentClassName,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = options.find((option) => option.value === value);
  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return options;
    return options.filter((option) => `${option.label} ${option.description || ""}`.toLocaleLowerCase().includes(normalized));
  }, [options, query]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const focusOption = (index: number) => {
    optionRefs.current[index]?.focus();
  };

  const handleOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusOption(nextEnabledIndex(filteredOptions, index, event.key === "ArrowDown" ? 1 : -1));
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const start = event.key === "Home" ? -1 : 0;
      const direction = event.key === "Home" ? 1 : -1;
      focusOption(nextEnabledIndex(filteredOptions, start, direction));
    }
  };

  return (
    <FloatingLayer
      open={open}
      onOpenChange={(next) => {
        if (!disabled) setOpen(next);
      }}
      trigger={(
        <button
          type="button"
          disabled={disabled}
          aria-label={`${label}: ${selected?.label || placeholder || label}`}
          className={cn(
            "inline-flex h-9 min-w-0 items-center justify-between gap-2 rounded-md border border-border bg-surface-1 px-3 text-sm text-ink-strong shadow-xs",
            "transition-[color,background-color,border-color,box-shadow] duration-fast ease-standard",
            "hover:border-ink-disabled hover:bg-surface-2 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
            "disabled:pointer-events-none disabled:opacity-45",
            className,
          )}
        >
          <span className="min-w-0 truncate">{selected?.label || placeholder || label}</span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-ink-muted transition-transform duration-fast", open && "rotate-180")} aria-hidden="true" />
        </button>
      )}
      contentLabel={label}
      role="listbox"
      side={side}
      align={align}
      matchTriggerWidth
      autoFocus="first"
      className={cn("min-w-56 p-1.5", contentClassName)}
    >
      {searchable ? (
        <div className="sticky top-0 z-[1] mb-1 flex items-center gap-2 rounded-md border border-border bg-surface-1 px-2.5 shadow-xs">
          <Search className="h-3.5 w-3.5 shrink-0 text-ink-muted" aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={searchPlaceholder}
            className="h-9 min-w-0 flex-1 bg-transparent text-sm text-ink-strong outline-none placeholder:text-ink-disabled"
          />
        </div>
      ) : null}

      <div className="grid gap-0.5">
        {filteredOptions.map((option, index) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              ref={(node) => { optionRefs.current[index] = node; }}
              type="button"
              role="option"
              aria-selected={active}
              aria-disabled={option.disabled || undefined}
              disabled={option.disabled}
              autoFocus={!searchable && active}
              onKeyDown={(event) => handleOptionKeyDown(event, index)}
              onClick={() => {
                if (option.disabled) return;
                onValueChange(option.value);
                setOpen(false);
              }}
              className={cn(
                "grid min-h-10 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2.5 py-2 text-left",
                "transition-[color,background-color] duration-instant ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30",
                active ? "bg-primary/10 text-primary" : "text-ink hover:bg-surface-2 hover:text-ink-strong",
                option.disabled && "cursor-not-allowed opacity-45",
              )}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{option.label}</span>
                {option.description ? <span className="mt-0.5 block truncate text-xs text-ink-muted">{option.description}</span> : null}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                {option.badge ? <span className="status-soft">{option.badge}</span> : null}
                {active ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
              </span>
            </button>
          );
        })}
        {!filteredOptions.length ? <div className="px-3 py-6 text-center text-sm text-ink-muted">{emptyLabel}</div> : null}
      </div>
    </FloatingLayer>
  );
}
