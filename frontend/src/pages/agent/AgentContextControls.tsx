import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Cpu, Workflow } from "lucide-react";
import type { CommercialModelProvider, ExecutionMode } from "@/lib/api";
import { cn } from "@/lib/utils";
import { FloatingLayer } from "@/components/ui/FloatingLayer";

export interface ExecutionModeOption {
  value: ExecutionMode;
  label: string;
}

export interface AgentContextControlsProps {
  executionMode: ExecutionMode;
  executionOptions: ExecutionModeOption[];
  onExecutionModeChange: (mode: ExecutionMode) => void;
  providers: CommercialModelProvider[];
  selectedProviderId: string | null;
  onProviderChange: (providerId: string) => void;
  controlsLocked: boolean;
}

const triggerClass = cn(
  "inline-flex h-9 min-w-0 items-center gap-2 rounded-md border border-border bg-surface-1 px-3 text-xs font-medium text-ink-muted shadow-xs",
  "transition-[color,background-color,border-color,box-shadow] duration-fast ease-standard",
  "hover:border-ink-disabled hover:bg-surface-2 hover:text-ink-strong hover:shadow-sm",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:pointer-events-none disabled:opacity-45",
);

export function AgentContextControls({
  executionMode,
  executionOptions,
  onExecutionModeChange,
  providers,
  selectedProviderId,
  onProviderChange,
  controlsLocked,
}: AgentContextControlsProps) {
  const { t } = useTranslation();
  const [executionOpen, setExecutionOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const selectedExecution = executionOptions.find((option) => option.value === executionMode) || executionOptions[0];
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) || providers.find((provider) => provider.is_default) || providers[0];

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <FloatingLayer
        open={executionOpen}
        onOpenChange={(open) => {
          if (controlsLocked) return;
          setExecutionOpen(open);
          if (open) setModelOpen(false);
        }}
        trigger={(
          <button type="button" disabled={controlsLocked} className={triggerClass} title={t("executionTrace.mode")}>
            <Workflow className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
            <span className="min-w-10 truncate text-ink-strong">{selectedExecution?.label}</span>
            <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform duration-fast", executionOpen && "rotate-180")} aria-hidden="true" />
          </button>
        )}
        contentLabel={t("executionTrace.mode")}
        role="menu"
        side="top"
        align="start"
        autoFocus="first"
        className="w-44"
      >
        {executionOptions.map((option) => {
          const active = option.value === executionMode;
          return (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              autoFocus={active}
              onClick={() => {
                onExecutionModeChange(option.value);
                setExecutionOpen(false);
              }}
              className={cn(
                "flex min-h-9 w-full items-center justify-between rounded-md px-2.5 text-left text-xs font-medium transition-colors duration-fast",
                active ? "bg-primary/10 text-primary" : "text-ink-muted hover:bg-surface-2 hover:text-ink-strong",
              )}
            >
              <span>{option.label}</span>
              {active ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
            </button>
          );
        })}
      </FloatingLayer>

      <FloatingLayer
        open={modelOpen}
        onOpenChange={(open) => {
          if (controlsLocked || providers.length === 0) return;
          setModelOpen(open);
          if (open) setExecutionOpen(false);
        }}
        trigger={(
          <button
            type="button"
            disabled={controlsLocked || providers.length === 0}
            className={cn(triggerClass, "max-w-full")}
            title={t("agent.modelPicker.title")}
          >
            <Cpu className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
            <span className="shrink-0">{t("agent.modelPicker.label")}</span>
            {selectedProvider ? <span className="max-w-56 truncate text-ink-strong">{selectedProvider.model}</span> : null}
            <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform duration-fast", modelOpen && "rotate-180")} aria-hidden="true" />
          </button>
        )}
        contentLabel={t("agent.modelPicker.title")}
        role="listbox"
        side="top"
        align="start"
        autoFocus="first"
        className="w-[min(25rem,calc(100vw-1rem))] p-1.5"
      >
        <div className="mb-1 border-b border-[hsl(var(--border-subtle))] px-2.5 py-2 text-xs font-semibold text-ink-strong">
          {t("agent.modelPicker.title")}
        </div>
        <div className="grid gap-0.5">
          {providers.map((provider) => {
            const active = provider.id === selectedProvider?.id;
            return (
              <button
                key={provider.id}
                type="button"
                role="option"
                aria-selected={active}
                autoFocus={active}
                onClick={() => {
                  onProviderChange(provider.id);
                  setModelOpen(false);
                }}
                className={cn(
                  "grid min-h-12 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors duration-fast",
                  active ? "bg-primary/10 text-primary" : "text-ink hover:bg-surface-2 hover:text-ink-strong",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{provider.model}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-ink-muted">{provider.provider} · {provider.base_url}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {provider.is_default ? <span className="status-primary">{t("agent.modelPicker.default")}</span> : null}
                  {active ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </FloatingLayer>
    </div>
  );
}
