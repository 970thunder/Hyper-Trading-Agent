import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { Search, X } from "lucide-react";
import { api, type MarketSymbolCandidate } from "@/lib/api";
import { cn } from "@/lib/utils";

function symbolsFrom(value: string) {
  return Array.from(new Set(value.split(/[\s,;]+/).map((item) => item.trim().toUpperCase()).filter(Boolean)));
}

function activeQuery(value: string) {
  const values = value.split(/[\s,;]+/);
  return values[values.length - 1]?.trim() || "";
}

export interface SymbolMultiSelectProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
}

export function SymbolMultiSelect({ value, onChange, placeholder, ariaLabel, className }: SymbolMultiSelectProps) {
  const listboxId = useId();
  const [focused, setFocused] = useState(false);
  const [matches, setMatches] = useState<MarketSymbolCandidate[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const query = activeQuery(value);
  const symbols = useMemo(() => symbolsFrom(value), [value]);
  const visibleMatches = focused && query.length >= 2 ? matches : [];

  useEffect(() => {
    if (query.length < 2) {
      setMatches([]);
      setActiveIndex(0);
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void api.searchMarketSymbols(query).then((result) => {
        if (!active) return;
        setMatches(result.candidates || []);
        setActiveIndex(0);
      }).catch(() => {
        if (active) setMatches([]);
      });
    }, 240);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  const select = (candidate: MarketSymbolCandidate) => {
    const next = value.replace(/[^,;\s]*$/, candidate.symbol);
    onChange(/[\s,;]$/.test(next) ? next : `${next}, `);
    setMatches([]);
    setActiveIndex(0);
  };

  const remove = (symbol: string) => onChange(symbols.filter((item) => item !== symbol).join(", "));

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!visibleMatches.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % visibleMatches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + visibleMatches.length) % visibleMatches.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      select(visibleMatches[activeIndex]);
    } else if (event.key === "Escape") {
      setFocused(false);
    }
  };

  return <div className={cn("relative", className)}>
    <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-muted" aria-hidden="true" />
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => window.setTimeout(() => setFocused(false), 120)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-autocomplete="list"
      aria-controls={visibleMatches.length ? listboxId : undefined}
      aria-expanded={visibleMatches.length > 0}
      className="h-9 w-full rounded-md border border-border bg-surface-1 pl-9 pr-3 text-sm text-ink-strong shadow-xs outline-none transition placeholder:text-ink-disabled focus:border-primary/60 focus:ring-2 focus:ring-primary/20"
    />
    {visibleMatches.length ? <div id={listboxId} role="listbox" className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-surface-elevated py-1 shadow-lg">
      {visibleMatches.map((item, index) => <button key={item.symbol} type="button" role="option" aria-selected={index === activeIndex} onMouseDown={(event) => event.preventDefault()} onClick={() => select(item)} className={cn("flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm", index === activeIndex ? "bg-primary/10" : "hover:bg-surface-2")}>
        <span className="min-w-0"><span className="font-medium text-ink-strong">{item.symbol}</span>{item.name ? <span className="ml-2 truncate text-ink-muted">{item.name}</span> : null}</span>
        <span className="shrink-0 text-xs text-ink-muted">{item.exchange || item.market || item.type || ""}</span>
      </button>)}
    </div> : null}
    {symbols.length ? <div className="mt-2 flex flex-wrap gap-1.5" aria-label={ariaLabel}>
      {symbols.map((symbol) => <button key={symbol} type="button" onClick={() => remove(symbol)} className="inline-flex h-6 items-center gap-1 rounded border border-border bg-surface-2 px-2 font-mono text-xs text-ink hover:border-primary/50 hover:text-primary">
        {symbol}<X className="h-3 w-3" aria-hidden="true" />
      </button>)}
    </div> : null}
  </div>;
}
