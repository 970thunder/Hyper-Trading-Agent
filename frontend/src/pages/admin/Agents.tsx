import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Bot } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  api,
  type CommercialModelProvider,
  type LLMProviderOption,
  type SwarmPreset,
  type SwarmPresetAgent,
  type SwarmPresetAgentList,
  type SwarmPresetAgentRequest,
} from "@/lib/api";
import { InlineError, Skeleton } from "@/components/ui/AsyncState";
import { SwarmAgentsPanel, type SwarmAgentFormState } from "@/pages/settings/SwarmAgentsPanel";

export function Agents() {
  const { t } = useTranslation();
  const [providerOptions, setProviderOptions] = useState<LLMProviderOption[]>([]);
  const [providers, setProviders] = useState<CommercialModelProvider[]>([]);
  const [presets, setPresets] = useState<SwarmPreset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState("quant_strategy_desk");
  const [agentList, setAgentList] = useState<SwarmPresetAgentList | null>(null);
  const [form, setForm] = useState<SwarmAgentFormState>(() => toForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const loadAgents = async (presetName: string) => {
    setSelectedPreset(presetName);
    setAgentList(await api.listSwarmPresetAgents(presetName));
    setEditingId(null);
    setForm(toForm());
  };

  const load = async (preferredPreset = selectedPreset) => {
    setError("");
    const [nextProviders, nextProviderOptions, nextPresets] = await Promise.all([
      api.listCommercialModelProviders(),
      api.listCommercialModelCatalog(),
      api.listSwarmPresets(),
    ]);
    setProviders(nextProviders);
    setProviderOptions(nextProviderOptions);
    setPresets(nextPresets);
    const nextPreset = nextPresets.some((preset) => preset.name === preferredPreset) ? preferredPreset : nextPresets[0]?.name || "";
    if (nextPreset) await loadAgents(nextPreset);
    else setAgentList(null);
  };

  useEffect(() => {
    let alive = true;
    load()
      .catch((loadError) => { if (alive) setError(errorMessage(loadError)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const modelOptions = useMemo(() => {
    const values = new Set<string>();
    providerOptions.forEach((provider) => {
      if (provider.default_model) values.add(provider.default_model);
      provider.model_options?.forEach((model) => values.add(model));
    });
    providers.forEach((provider) => values.add(provider.model));
    if (form.model_name) values.add(form.model_name);
    return Array.from(values).sort();
  }, [form.model_name, providers, providerOptions]);

  const selectedModelValue = form.model_provider_id ? `provider:${form.model_provider_id}` : form.model_name ? `model:${form.model_name}` : "";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload: SwarmPresetAgentRequest = {
      id: form.id.trim(),
      role: form.role.trim(),
      system_prompt: form.system_prompt.trim(),
      tools: splitList(form.tools),
      skills: splitList(form.skills),
      max_iterations: form.max_iterations,
      timeout_seconds: form.timeout_seconds,
      model_name: form.model_name.trim() || null,
      model_provider_id: form.model_provider_id.trim() || null,
      max_retries: form.max_retries,
    };
    if (!payload.id) return;
    setSaving(true);
    try {
      if (editingId) await api.updateSwarmPresetAgent(selectedPreset, editingId, payload);
      else await api.createSwarmPresetAgent(selectedPreset, payload);
      setFormOpen(false);
      await loadAgents(selectedPreset);
      toast.success(editingId ? t("settings.swarmAgents.updated") : t("settings.swarmAgents.created"));
    } catch (submitError) {
      toast.error(errorMessage(submitError));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (agent: SwarmPresetAgent) => {
    setDeletingId(agent.id);
    try {
      const result = await api.deleteSwarmPresetAgent(selectedPreset, agent.id);
      await loadAgents(selectedPreset);
      toast.success(t("settings.swarmAgents.deleted", { count: result.removed_task_ids.length }));
    } catch (removeError) {
      toast.error(errorMessage(removeError));
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) return <div className="grid gap-4"><Skeleton className="h-20" /><Skeleton className="h-[540px]" /></div>;
  if (error) return <InlineError title={t("adminCenter.agents.loadFailed")} message={error} retryLabel={t("adminCenter.retry")} onRetry={() => void load()} />;

  return (
    <div data-page-enter className="grid gap-4">
      <header>
        <div className="flex items-center gap-2"><Bot className="h-5 w-5 text-primary" /><h2 className="text-xl font-semibold text-ink-strong">{t("adminCenter.agents.title")}</h2></div>
        <p className="mt-1 max-w-3xl text-sm leading-5 text-ink-muted">{t("adminCenter.agents.description")}</p>
      </header>
      <SwarmAgentsPanel
        presets={presets}
        selectedPreset={selectedPreset}
        agentList={agentList}
        form={form}
        editingAgentId={editingId}
        saving={saving}
        deletingAgentId={deletingId}
        commercialModelProviders={providers}
        modelOptions={modelOptions}
        selectedModelValue={selectedModelValue}
        formOpen={formOpen}
        onFormOpenChange={setFormOpen}
        onRefresh={() => load(selectedPreset)}
        onPresetChange={loadAgents}
        onResetForm={() => { setEditingId(null); setForm(toForm()); }}
        onEditAgent={(agent) => { setEditingId(agent.id); setForm(toForm(agent)); }}
        onDeleteAgent={remove}
        onSubmit={submit}
        onFormChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
        onModelChange={(value) => {
          if (value.startsWith("provider:")) {
            const providerId = value.slice("provider:".length);
            const provider = providers.find((item) => item.id === providerId);
            setForm((current) => ({ ...current, model_provider_id: providerId, model_name: provider?.model || "" }));
          } else if (value.startsWith("model:")) {
            setForm((current) => ({ ...current, model_provider_id: "", model_name: value.slice("model:".length) }));
          } else {
            setForm((current) => ({ ...current, model_provider_id: "", model_name: "" }));
          }
        }}
      />
    </div>
  );
}

function toForm(agent?: SwarmPresetAgent): SwarmAgentFormState {
  return {
    id: agent?.id || "",
    role: agent?.role || "",
    system_prompt: agent?.system_prompt || "",
    tools: (agent?.tools || []).join(", "),
    skills: (agent?.skills || []).join(", "),
    max_iterations: agent?.max_iterations || 25,
    timeout_seconds: agent?.timeout_seconds || 300,
    model_name: agent?.model_name || "",
    model_provider_id: agent?.model_provider_id || "",
    max_retries: agent?.max_retries || 2,
  };
}

function splitList(value: string) {
  return value.replace(/\n/g, ",").split(",").map((item) => item.trim()).filter(Boolean);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}
