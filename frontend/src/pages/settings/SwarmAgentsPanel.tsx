import type { FormEvent } from "react";
import { Brain, Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { CommercialModelProvider, SwarmPreset, SwarmPresetAgent, SwarmPresetAgentList } from "@/lib/api";
import { cn } from "@/lib/utils";

const fieldClass =
  "w-full rounded-md border border-border/75 bg-background px-3 py-2 text-sm outline-none transition focus:border-primary/70 focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60";
const labelClass = "text-sm font-medium";
const sectionCardClass = "rounded-lg border border-border/70 bg-card p-5 shadow-sm";

export interface SwarmAgentFormState {
  id: string;
  role: string;
  system_prompt: string;
  tools: string;
  skills: string;
  max_iterations: number;
  timeout_seconds: number;
  model_name: string;
  model_provider_id: string;
  max_retries: number;
}

interface SwarmAgentsPanelProps {
  presets: SwarmPreset[];
  selectedPreset: string;
  agentList: SwarmPresetAgentList | null;
  form: SwarmAgentFormState;
  editingAgentId: string | null;
  saving: boolean;
  deletingAgentId: string | null;
  commercialModelProviders: CommercialModelProvider[];
  modelOptions: string[];
  selectedModelValue: string;
  onRefresh: () => Promise<void> | void;
  onPresetChange: (presetName: string) => Promise<void> | void;
  onResetForm: () => void;
  onEditAgent: (agent: SwarmPresetAgent) => void;
  onDeleteAgent: (agent: SwarmPresetAgent) => Promise<void> | void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onFormChange: (patch: Partial<SwarmAgentFormState>) => void;
  onModelChange: (value: string) => void;
}

export function SwarmAgentsPanel({
  presets,
  selectedPreset,
  agentList,
  form,
  editingAgentId,
  saving,
  deletingAgentId,
  commercialModelProviders,
  modelOptions,
  selectedModelValue,
  onRefresh,
  onPresetChange,
  onResetForm,
  onEditAgent,
  onDeleteAgent,
  onSubmit,
  onFormChange,
  onModelChange,
}: SwarmAgentsPanelProps) {
  const { t } = useTranslation();

  const handleRefresh = () => {
    Promise.resolve(onRefresh()).catch((error) => {
      toast.error(t("settings.swarmAgents.loadFailed", { message: error instanceof Error ? error.message : t("settings.unknownError") }));
    });
  };

  const handlePresetChange = (presetName: string) => {
    Promise.resolve(onPresetChange(presetName)).catch((error) => {
      toast.error(t("settings.swarmAgents.loadFailed", { message: error instanceof Error ? error.message : t("settings.unknownError") }));
    });
  };

  const modelLabel = (agent: SwarmPresetAgent) => {
    if (agent.model_provider_id) {
      const provider = commercialModelProviders.find((item) => item.id === agent.model_provider_id);
      if (provider) {
        return `${provider.provider} / ${provider.model}${provider.is_default ? ` (${t("settings.modelProviders.default")})` : ""}`;
      }
      return agent.model_name ? `${agent.model_name} (${agent.model_provider_id})` : agent.model_provider_id;
    }
    return agent.model_name || t("settings.swarmAgents.defaultModel");
  };

  return (
    <section className={sectionCardClass}>
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">{t("settings.swarmAgents.title")}</h2>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">{t("settings.swarmAgents.description")}</p>
        </div>
        <button type="button" onClick={handleRefresh} className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground">
          <RefreshCw className="h-4 w-4" />
          {t("settings.refresh")}
        </button>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <label className="grid gap-2">
          <span className={labelClass}>{t("settings.swarmAgents.preset")}</span>
          <select value={selectedPreset} onChange={(event) => handlePresetChange(event.target.value)} className={fieldClass}>
            {presets.map((preset) => (
              <option key={preset.name} value={preset.name}>{swarmPresetDisplayName(t, preset)}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={onResetForm} className="inline-flex items-center justify-center gap-2 self-end rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90">
          <Plus className="h-4 w-4" />
          {t("settings.swarmAgents.newAgent")}
        </button>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.1fr)]">
        <div className="overflow-hidden rounded-md border">
          <div className="border-b bg-muted/20 px-3 py-2 text-sm font-semibold">
            {agentList
              ? swarmPresetDisplayName(t, { name: agentList.preset_name, title: agentList.title, description: agentList.description, agent_count: agentList.agents.length, variables: [] })
              : selectedPreset}
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">{t("settings.swarmAgents.agent")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("settings.swarmAgents.model")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("settings.swarmAgents.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {agentList?.agents.length ? agentList.agents.map((agent) => (
                <tr key={agent.id} className={cn("border-t", editingAgentId === agent.id && "bg-primary/5")}>
                  <td className="px-3 py-2 align-top">
                    <div className="font-medium">{swarmAgentRoleDisplayName(t, selectedPreset, agent)}</div>
                    <div className="text-xs text-muted-foreground">{agent.id} · {t("settings.swarmAgents.taskCount", { count: agent.task_count ?? 0 })}</div>
                  </td>
                  <td className="max-w-[220px] truncate px-3 py-2 align-top text-xs text-muted-foreground" title={modelLabel(agent)}>
                    {modelLabel(agent)}
                  </td>
                  <td className="px-3 py-2 text-right align-top">
                    <div className="inline-flex items-center gap-1">
                      <button type="button" aria-label={`Edit ${agent.id}`} onClick={() => onEditAgent(agent)} className="rounded-md border px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" aria-label={`Delete ${agent.id}`} onClick={() => onDeleteAgent(agent)} disabled={deletingAgentId === agent.id} className="rounded-md border px-2 py-1 text-xs text-muted-foreground transition hover:border-destructive/40 hover:text-destructive disabled:opacity-50">
                        {deletingAgentId === agent.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={3} className="px-3 py-8 text-center text-sm text-muted-foreground">{t("settings.swarmAgents.empty")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <form onSubmit={onSubmit} className="rounded-md border bg-muted/10 p-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">{editingAgentId ? t("settings.swarmAgents.editAgent") : t("settings.swarmAgents.createAgent")}</h3>
              <p className="mt-1 text-xs text-muted-foreground">{t("settings.swarmAgents.formHint")}</p>
            </div>
            {editingAgentId ? (
              <button type="button" onClick={onResetForm} className="rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground">
                {t("settings.cancel")}
              </button>
            ) : null}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <TextField label={t("settings.swarmAgents.id")} value={form.id} onChange={(value) => onFormChange({ id: value })} />
            <TextField label={t("settings.swarmAgents.role")} value={form.role} onChange={(value) => onFormChange({ role: value })} />
            <label className="grid gap-2 md:col-span-2">
              <span className={labelClass}>{t("settings.swarmAgents.model")}</span>
              <select value={selectedModelValue} onChange={(event) => onModelChange(event.target.value)} className={fieldClass}>
                <option value="">{t("settings.swarmAgents.defaultModel")}</option>
                {commercialModelProviders.length ? (
                  <optgroup label={t("settings.swarmAgents.configuredModels")}>
                    {commercialModelProviders.map((provider) => (
                      <option key={provider.id} value={`provider:${provider.id}`}>
                        {provider.provider} / {provider.model}{provider.is_default ? ` (${t("settings.modelProviders.default")})` : ""}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                <optgroup label={t("settings.swarmAgents.compatibleModelNames")}>
                  {modelOptions.map((model) => (
                    <option key={model} value={`model:${model}`}>{model}</option>
                  ))}
                </optgroup>
              </select>
            </label>
            <NumberField label={t("settings.swarmAgents.maxIterations")} value={form.max_iterations} min={1} max={200} step={1} onChange={(value) => onFormChange({ max_iterations: value })} />
            <NumberField label={t("settings.swarmAgents.timeoutSeconds")} value={form.timeout_seconds} min={10} max={7200} step={10} onChange={(value) => onFormChange({ timeout_seconds: value })} />
            <NumberField label={t("settings.swarmAgents.maxRetries")} value={form.max_retries} min={0} max={10} step={1} onChange={(value) => onFormChange({ max_retries: value })} />
            <label className="grid gap-2">
              <span className={labelClass}>{t("settings.swarmAgents.tools")}</span>
              <textarea value={form.tools} onChange={(event) => onFormChange({ tools: event.target.value })} className={`${fieldClass} min-h-24`} />
            </label>
            <label className="grid gap-2">
              <span className={labelClass}>{t("settings.swarmAgents.skills")}</span>
              <textarea value={form.skills} onChange={(event) => onFormChange({ skills: event.target.value })} className={`${fieldClass} min-h-24`} />
            </label>
            <label className="grid gap-2 md:col-span-2">
              <span className={labelClass}>{t("settings.swarmAgents.systemPrompt")}</span>
              <textarea value={form.system_prompt} onChange={(event) => onFormChange({ system_prompt: event.target.value })} className={`${fieldClass} min-h-52 font-mono text-xs`} />
            </label>
          </div>
          <button type="submit" disabled={saving} className="mt-4 inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {editingAgentId ? t("settings.swarmAgents.update") : t("settings.swarmAgents.create")}
          </button>
        </form>
      </div>
    </section>
  );
}

function swarmPresetDisplayName(t: TFunction, preset: SwarmPreset): string {
  return String(t(`settings.swarmPresetNames.${preset.name}`, { defaultValue: preset.title || preset.name }));
}

function swarmAgentRoleDisplayName(
  t: TFunction,
  presetName: string,
  agent: Pick<SwarmPresetAgent, "id" | "role">,
): string {
  return String(t(`settings.swarmAgentRoles.${presetName}.${agent.id}`, { defaultValue: agent.role || agent.id }));
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-2">
      <span className={labelClass}>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} className={fieldClass} />
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid gap-2">
      <span className={labelClass}>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className={fieldClass}
      />
    </label>
  );
}
