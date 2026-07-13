import { useId, useState, type FormEvent } from "react";
import { Bot, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { CommercialModelProvider, SwarmPreset, SwarmPresetAgent, SwarmPresetAgentList } from "@/lib/api";
import { Button, IconButton } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Drawer } from "@/components/ui/Drawer";
import { Field, Input, NumberInput, Textarea } from "@/components/ui/Field";
import { Panel, SectionHeader } from "@/components/ui/Panel";
import { Select, type SelectOption } from "@/components/ui/Select";
import { StatusIndicator } from "@/components/ui/Status";
import { cn } from "@/lib/utils";

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
  formOpen: boolean;
  onFormOpenChange: (open: boolean) => void;
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
  formOpen,
  onFormOpenChange,
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
  const formId = `swarm-agent-${useId().replace(/:/g, "")}`;
  const [deleteTarget, setDeleteTarget] = useState<SwarmPresetAgent | null>(null);
  const presetOptions: SelectOption[] = presets.map((preset) => ({
    value: preset.name,
    label: swarmPresetDisplayName(t, preset),
    description: preset.description,
    badge: String(preset.agent_count),
  }));
  const modelSelectOptions = buildModelOptions(t, commercialModelProviders, modelOptions);

  const refresh = () => {
    Promise.resolve(onRefresh()).catch((error) => {
      toast.error(t("settings.swarmAgents.loadFailed", { message: error instanceof Error ? error.message : t("settings.unknownError") }));
    });
  };

  const changePreset = (presetName: string) => {
    Promise.resolve(onPresetChange(presetName)).catch((error) => {
      toast.error(t("settings.swarmAgents.loadFailed", { message: error instanceof Error ? error.message : t("settings.unknownError") }));
    });
  };

  const openCreate = () => {
    onResetForm();
    onFormOpenChange(true);
  };

  const openEdit = (agent: SwarmPresetAgent) => {
    onEditAgent(agent);
    onFormOpenChange(true);
  };

  const modelLabel = (agent: SwarmPresetAgent) => {
    if (agent.model_provider_id) {
      const provider = commercialModelProviders.find((item) => item.id === agent.model_provider_id);
      if (provider) return `${provider.provider} / ${provider.model}`;
      return agent.model_name || agent.model_provider_id;
    }
    return agent.model_name || t("settings.swarmAgents.defaultModel");
  };

  return (
    <>
      <Panel padding="none" className="overflow-hidden">
        <SectionHeader
          className="border-b border-[hsl(var(--border-subtle))] p-4"
          title={t("settings.swarmAgents.title")}
          description={t("settings.swarmAgents.description")}
          actions={(
            <>
              <Button variant="ghost" leftIcon={<RefreshCw className="h-4 w-4" />} onClick={refresh}>
                {t("settings.refresh")}
              </Button>
              <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={openCreate}>
                {t("settings.swarmAgents.newAgent")}
              </Button>
            </>
          )}
        />

        <div className="flex flex-col gap-3 border-b border-[hsl(var(--border-subtle))] bg-surface-2 px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
          <Field label={t("settings.swarmAgents.preset")} className="w-full sm:max-w-md">
            <Select
              value={selectedPreset}
              onValueChange={changePreset}
              options={presetOptions}
              label={t("settings.swarmAgents.preset")}
              searchable
              className="w-full"
              contentClassName="max-h-96"
            />
          </Field>
          <div className="text-xs text-ink-muted">
            {t("settings.swarmAgents.agentCount", { count: agentList?.agents.length || 0 })}
          </div>
        </div>

        {agentList?.agents.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-[hsl(var(--border-subtle))] bg-surface-1 text-xs text-ink-muted">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">{t("settings.swarmAgents.agent")}</th>
                  <th className="px-4 py-2.5 text-left font-medium">{t("settings.swarmAgents.model")}</th>
                  <th className="px-4 py-2.5 text-left font-medium">{t("settings.swarmAgents.executionPolicy")}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t("settings.swarmAgents.actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[hsl(var(--border-subtle))]">
                {agentList.agents.map((agent) => (
                  <tr
                    key={agent.id}
                    className={cn(
                      "transition-[background-color] duration-fast ease-standard hover:bg-surface-2",
                      editingAgentId === agent.id && "bg-primary/5",
                    )}
                  >
                    <td className="px-4 py-3 align-top">
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                          <Bot className="h-4 w-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="font-medium text-ink-strong">{swarmAgentRoleDisplayName(t, selectedPreset, agent)}</p>
                          <p className="mt-0.5 text-xs text-ink-muted">{agent.id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="max-w-xs px-4 py-3 align-top">
                      <p className="truncate text-xs text-ink" title={modelLabel(agent)}>{modelLabel(agent)}</p>
                      {agent.model_provider_id ? <StatusIndicator className="mt-1.5" label={t("settings.swarmAgents.configuredModel")} tone="primary" /> : null}
                    </td>
                    <td className="px-4 py-3 align-top text-xs tabular-nums text-ink-muted">
                      <p>{t("settings.swarmAgents.iterationSummary", { count: agent.max_iterations, retries: agent.max_retries })}</p>
                      <p className="mt-1">{t("settings.swarmAgents.timeoutSummary", { seconds: agent.timeout_seconds })}</p>
                      <p className="mt-1">{t("settings.swarmAgents.taskCount", { count: agent.task_count ?? 0 })}</p>
                    </td>
                    <td className="px-4 py-3 text-right align-top">
                      <div className="inline-flex items-center gap-1">
                        <IconButton label={`Edit ${agent.id}`} variant="ghost" onClick={() => openEdit(agent)}>
                          <Pencil className="h-4 w-4" />
                        </IconButton>
                        <IconButton
                          label={`Delete ${agent.id}`}
                          variant="ghost"
                          loading={deletingAgentId === agent.id}
                          className="text-danger hover:bg-danger/10 hover:text-danger"
                          onClick={() => setDeleteTarget(agent)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid min-h-52 place-items-center px-6 py-10 text-center">
            <div>
              <Bot className="mx-auto h-7 w-7 text-ink-disabled" />
              <p className="mt-3 text-sm text-ink-muted">{t("settings.swarmAgents.empty")}</p>
              <Button className="mt-4" variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={openCreate}>
                {t("settings.swarmAgents.newAgent")}
              </Button>
            </div>
          </div>
        )}
      </Panel>

      <Drawer
        open={formOpen}
        onOpenChange={onFormOpenChange}
        title={editingAgentId ? t("settings.swarmAgents.editAgent") : t("settings.swarmAgents.createAgent")}
        description={t("settings.swarmAgents.formHint")}
        closeLabel={t("settings.cancel")}
        className="w-[min(44rem,calc(100vw-0.75rem))]"
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onFormOpenChange(false)}>{t("settings.cancel")}</Button>
            <Button type="submit" form={formId} variant="primary" loading={saving}>
              {editingAgentId ? t("settings.swarmAgents.update") : t("settings.swarmAgents.create")}
            </Button>
          </div>
        )}
      >
        <form id={formId} onSubmit={onSubmit} className="grid gap-5 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("settings.swarmAgents.id")} required>
              <Input value={form.id} disabled={Boolean(editingAgentId)} onChange={(event) => onFormChange({ id: event.target.value })} required />
            </Field>
            <Field label={t("settings.swarmAgents.role")} required>
              <Input value={form.role} onChange={(event) => onFormChange({ role: event.target.value })} required />
            </Field>
          </div>

          <Field label={t("settings.swarmAgents.model")}>
            <Select
              value={selectedModelValue}
              onValueChange={onModelChange}
              options={modelSelectOptions}
              label={t("settings.swarmAgents.model")}
              placeholder={t("settings.swarmAgents.defaultModel")}
              searchable
              className="w-full"
              contentClassName="max-h-96"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("settings.swarmAgents.maxIterations")}>
              <NumberInput min={1} max={200} value={form.max_iterations} onChange={(event) => onFormChange({ max_iterations: Number(event.target.value) })} />
            </Field>
            <Field label={t("settings.swarmAgents.timeoutSeconds")}>
              <NumberInput min={10} max={7200} step={10} value={form.timeout_seconds} onChange={(event) => onFormChange({ timeout_seconds: Number(event.target.value) })} />
            </Field>
            <Field label={t("settings.swarmAgents.maxRetries")}>
              <NumberInput min={0} max={10} value={form.max_retries} onChange={(event) => onFormChange({ max_retries: Number(event.target.value) })} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("settings.swarmAgents.tools")}>
              <Textarea value={form.tools} onChange={(event) => onFormChange({ tools: event.target.value })} />
            </Field>
            <Field label={t("settings.swarmAgents.skills")}>
              <Textarea value={form.skills} onChange={(event) => onFormChange({ skills: event.target.value })} />
            </Field>
          </div>

          <Field label={t("settings.swarmAgents.systemPrompt")}>
            <Textarea className="min-h-60 font-mono text-xs" value={form.system_prompt} onChange={(event) => onFormChange({ system_prompt: event.target.value })} />
          </Field>
        </form>
      </Drawer>

      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={t("settings.swarmAgents.deleteTitle")}
        description={t("settings.swarmAgents.deleteDescription", { name: deleteTarget ? swarmAgentRoleDisplayName(t, selectedPreset, deleteTarget) : "" })}
        closeLabel={t("settings.cancel")}
        className="w-[min(30rem,calc(100vw-2rem))]"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>{t("settings.cancel")}</Button>
            <Button
              variant="destructive"
              loading={Boolean(deleteTarget && deletingAgentId === deleteTarget.id)}
              leftIcon={<Trash2 className="h-4 w-4" />}
              onClick={() => {
                if (!deleteTarget) return;
                void Promise.resolve(onDeleteAgent(deleteTarget)).then(() => setDeleteTarget(null));
              }}
            >
              {t("settings.swarmAgents.delete")}
            </Button>
          </>
        )}
      >
        <p className="text-sm leading-6 text-ink">{t("settings.swarmAgents.deleteWarning")}</p>
      </Dialog>
    </>
  );
}

function buildModelOptions(
  t: TFunction,
  providers: CommercialModelProvider[],
  modelOptions: string[],
): SelectOption[] {
  const options: SelectOption[] = [{ value: "", label: String(t("settings.swarmAgents.defaultModel")) }];
  providers.forEach((provider) => {
    options.push({
      value: `provider:${provider.id}`,
      label: `${provider.provider} / ${provider.model}`,
      description: provider.base_url,
      badge: provider.is_default ? String(t("settings.modelProviders.default")) : undefined,
      disabled: !provider.enabled,
    });
  });
  modelOptions.forEach((model) => {
    options.push({ value: `model:${model}`, label: model, description: String(t("settings.swarmAgents.compatibleModelNames")) });
  });
  return options.filter((option, index, all) => all.findIndex((candidate) => candidate.value === option.value) === index);
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
