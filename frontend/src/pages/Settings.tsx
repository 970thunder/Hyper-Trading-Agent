import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Activity,
  BarChart3,
  Brain,
  ClipboardList,
  Database,
  Loader2,
  MessageSquareMore,
  Server,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  api,
  isAuthRequiredError,
  type AuditLog,
  type ChannelRuntimeStatus,
  type CommercialKnowledgeBase,
  type CommercialKnowledgeBackendStatus,
  type CommercialKnowledgeDocument,
  type CommercialKnowledgeSearchResult,
  type CommercialIngestionJob,
  type CommercialModelProvider,
  type CommercialModelProviderCreateRequest,
  type CommercialModelProviderUpdateRequest,
  type CommercialOrganizationMember,
  type CommercialPrincipal,
  type CommercialRole,
  type DataSourceSettings,
  type KnowledgeDocument,
  type KnowledgeSearchResult,
  type KnowledgeStats,
  type LLMProviderOption,
  type LLMSettings,
  type ModelUsage,
  type SwarmPreset,
  type SwarmPresetAgent,
  type SwarmPresetAgentList,
  type SwarmPresetAgentRequest,
  type ToolPolicy,
} from "@/lib/api";
import { getApiAuthKey, setApiAuthKey } from "@/lib/apiAuth";
import { cn } from "@/lib/utils";
import { AgentPolicyPanel } from "./settings/AgentPolicyPanel";
import { AuditUsagePanel } from "./settings/AuditUsagePanel";
import { ChannelsSettingsPanel } from "./settings/ChannelsSettingsPanel";
import { CommercialModelProvidersPanel, type ModelProviderFormState } from "./settings/CommercialModelProvidersPanel";
import { DataSourceSettingsPanel } from "./settings/DataSourceSettingsPanel";
import { KnowledgeSettingsPanel } from "./settings/KnowledgeSettingsPanel";
import { LocalModelSettingsPanel, type LLMFormState } from "./settings/LocalModelSettingsPanel";
import { OrganizationSecurityPanel } from "./settings/OrganizationSecurityPanel";
import { RuntimeSettingsPanel } from "./settings/RuntimeSettingsPanel";
import { SettingsOverviewPanel } from "./settings/SettingsOverviewPanel";
import { SwarmAgentsPanel, type SwarmAgentFormState } from "./settings/SwarmAgentsPanel";

type SettingsSection =
  | "overview"
  | "models"
  | "knowledge"
  | "data"
  | "agent"
  | "security"
  | "channels"
  | "runtime"
  | "audit";

const SETTINGS_SECTIONS: {
  id: SettingsSection;
  icon: typeof BarChart3;
  labelKey: string;
  descKey: string;
}[] = [
  { id: "overview", icon: BarChart3, labelKey: "settings.nav.overview", descKey: "settings.navDesc.overview" },
  { id: "models", icon: Server, labelKey: "settings.nav.models", descKey: "settings.navDesc.models" },
  { id: "knowledge", icon: Database, labelKey: "settings.nav.knowledge", descKey: "settings.navDesc.knowledge" },
  { id: "data", icon: SlidersHorizontal, labelKey: "settings.nav.data", descKey: "settings.navDesc.data" },
  { id: "agent", icon: Brain, labelKey: "settings.nav.agent", descKey: "settings.navDesc.agent" },
  { id: "security", icon: ShieldCheck, labelKey: "settings.nav.security", descKey: "settings.navDesc.security" },
  { id: "channels", icon: MessageSquareMore, labelKey: "settings.nav.channels", descKey: "settings.navDesc.channels" },
  { id: "runtime", icon: Activity, labelKey: "settings.nav.runtime", descKey: "settings.navDesc.runtime" },
  { id: "audit", icon: ClipboardList, labelKey: "settings.nav.audit", descKey: "settings.navDesc.audit" },
];

function toForm(settings: LLMSettings): LLMFormState {
  return {
    provider: settings.provider,
    model_name: settings.model_name,
    base_url: settings.base_url,
    temperature: settings.temperature,
    timeout_seconds: settings.timeout_seconds,
    max_retries: settings.max_retries,
    reasoning_effort: settings.reasoning_effort || "",
  };
}

function toModelProviderForm(settings: LLMSettings | null, provider?: LLMProviderOption): ModelProviderFormState {
  const selected = provider ?? settings?.providers?.[0];
  return {
    provider: selected?.name ?? settings?.provider ?? "siliconflow",
    model: selected?.default_model ?? settings?.model_name ?? "",
    base_url: selected?.default_base_url ?? settings?.base_url ?? "",
    api_key: "",
    clear_api_key: false,
    temperature: settings?.temperature ?? 0,
    timeout_seconds: settings?.timeout_seconds ?? 120,
    max_retries: settings?.max_retries ?? 2,
    enabled: true,
    is_default: false,
  };
}

function toSwarmAgentForm(agent?: SwarmPresetAgent): SwarmAgentFormState {
  return {
    id: agent?.id ?? "",
    role: agent?.role ?? "",
    system_prompt: agent?.system_prompt ?? "",
    tools: (agent?.tools ?? []).join(", "),
    skills: (agent?.skills ?? []).join(", "),
    max_iterations: agent?.max_iterations ?? 25,
    timeout_seconds: agent?.timeout_seconds ?? 300,
    model_name: agent?.model_name ?? "",
    model_provider_id: agent?.model_provider_id ?? "",
    max_retries: agent?.max_retries ?? 2,
  };
}

function splitList(value: string): string[] {
  return value
    .replace(/\n/g, ",")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isSettingsSection(value: string | null): value is SettingsSection {
  return SETTINGS_SECTIONS.some((section) => section.id === value);
}

function unavailable(message: string) {
  return (
    <div className="rounded-lg border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

export function Settings() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = searchParams.get("section");
  const activeSection: SettingsSection = isSettingsSection(requestedSection) ? requestedSection : "overview";

  const [settings, setSettings] = useState<LLMSettings | null>(null);
  const [dataSettings, setDataSettings] = useState<DataSourceSettings | null>(null);
  const [knowledgeStats, setKnowledgeStats] = useState<KnowledgeStats | null>(null);
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<KnowledgeDocument[]>([]);
  const [principal, setPrincipal] = useState<CommercialPrincipal | null>(null);
  const [knowledgeBases, setKnowledgeBases] = useState<CommercialKnowledgeBase[]>([]);
  const [commercialModelProviders, setCommercialModelProviders] = useState<CommercialModelProvider[]>([]);
  const [organizationMembers, setOrganizationMembers] = useState<CommercialOrganizationMember[]>([]);
  const [knowledgeBackendStatus, setKnowledgeBackendStatus] = useState<CommercialKnowledgeBackendStatus | null>(null);
  const [selectedKnowledgeBaseId, setSelectedKnowledgeBaseId] = useState("");
  const [commercialDocuments, setCommercialDocuments] = useState<CommercialKnowledgeDocument[]>([]);
  const [ingestionJobs, setIngestionJobs] = useState<CommercialIngestionJob[]>([]);
  const [knowledgeSearchResults, setKnowledgeSearchResults] = useState<Array<CommercialKnowledgeSearchResult | KnowledgeSearchResult>>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [modelUsage, setModelUsage] = useState<ModelUsage[]>([]);
  const [toolPolicies, setToolPolicies] = useState<ToolPolicy[]>([]);
  const [channelStatus, setChannelStatus] = useState<ChannelRuntimeStatus | null>(null);
  const [swarmPresets, setSwarmPresets] = useState<SwarmPreset[]>([]);
  const [selectedSwarmPreset, setSelectedSwarmPreset] = useState("quant_strategy_desk");
  const [swarmAgentList, setSwarmAgentList] = useState<SwarmPresetAgentList | null>(null);
  const [form, setForm] = useState<LLMFormState | null>(null);
  const [modelProviderForm, setModelProviderForm] = useState<ModelProviderFormState>(() => toModelProviderForm(null));
  const [editingModelProviderId, setEditingModelProviderId] = useState<string | null>(null);
  const [swarmAgentForm, setSwarmAgentForm] = useState<SwarmAgentFormState>(() => toSwarmAgentForm());
  const [editingSwarmAgentId, setEditingSwarmAgentId] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [localApiKey, setLocalApiKeyState] = useState(() => getApiAuthKey());
  const [clearApiKey, setClearApiKey] = useState(false);
  const [tushareToken, setTushareToken] = useState("");
  const [clearTushareToken, setClearTushareToken] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modelProviderSaving, setModelProviderSaving] = useState(false);
  const [modelProviderTestingId, setModelProviderTestingId] = useState<string | null>(null);
  const [swarmAgentSaving, setSwarmAgentSaving] = useState(false);
  const [deletingSwarmAgentId, setDeletingSwarmAgentId] = useState<string | null>(null);
  const [memberSaving, setMemberSaving] = useState(false);
  const [memberActionId, setMemberActionId] = useState<string | null>(null);
  const [dataSaving, setDataSaving] = useState(false);
  const [knowledgeSaving, setKnowledgeSaving] = useState(false);
  const [knowledgeJobAction, setKnowledgeJobAction] = useState<string | null>(null);
  const [toolPolicySaving, setToolPolicySaving] = useState<string | null>(null);
  const [knowledgeSearching, setKnowledgeSearching] = useState(false);
  const [knowledgePath, setKnowledgePath] = useState("");
  const [knowledgeTitle, setKnowledgeTitle] = useState("");
  const [knowledgeUrl, setKnowledgeUrl] = useState("");
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [knowledgeFile, setKnowledgeFile] = useState<File | null>(null);
  const [creatingKnowledgeBase, setCreatingKnowledgeBase] = useState(false);
  const [channelRefreshing, setChannelRefreshing] = useState(false);
  const [channelAction, setChannelAction] = useState<"start" | "stop" | null>(null);
  const [loadErrors, setLoadErrors] = useState<Record<string, string>>({});

  const setSection = (section: SettingsSection) => {
    const next = new URLSearchParams(searchParams);
    next.set("section", section);
    setSearchParams(next, { replace: true });
  };

  const loadCommercialKnowledge = async (preferredKnowledgeBaseId = selectedKnowledgeBaseId) => {
    const [bases, backendStatus] = await Promise.all([
      api.listKnowledgeBases(),
      api.getCommercialKnowledgeBackendStatus().catch(() => null),
    ]);
    setKnowledgeBases(bases);
    setKnowledgeBackendStatus(backendStatus);
    const nextId = preferredKnowledgeBaseId && bases.some((kb) => kb.id === preferredKnowledgeBaseId)
      ? preferredKnowledgeBaseId
      : bases[0]?.id || "";
    setSelectedKnowledgeBaseId(nextId);
    if (nextId) {
      const [docs, jobs] = await Promise.all([
        api.listCommercialKnowledgeDocuments(nextId),
        api.listCommercialIngestionJobs(nextId, 20).catch(() => []),
      ]);
      setCommercialDocuments(docs);
      setIngestionJobs(jobs);
    } else {
      setCommercialDocuments([]);
      setIngestionJobs([]);
    }
  };

  const loadCommercialModels = async () => {
    setCommercialModelProviders(await api.listCommercialModelProviders());
  };

  const canViewOrganizationMembers = (role?: CommercialRole) => role === "owner" || role === "admin";

  const loadOrganizationMembers = async () => {
    setOrganizationMembers(await api.listOrganizationMembers());
  };

  const loadSwarmPresets = async (preferredPreset = selectedSwarmPreset) => {
    const presets = await api.listSwarmPresets();
    setSwarmPresets(presets);
    const nextPreset = presets.some((preset) => preset.name === preferredPreset)
      ? preferredPreset
      : presets[0]?.name || "quant_strategy_desk";
    setSelectedSwarmPreset(nextPreset);
    if (nextPreset) {
      setSwarmAgentList(await api.listSwarmPresetAgents(nextPreset));
    } else {
      setSwarmAgentList(null);
    }
  };

  const loadSwarmAgents = async (presetName: string) => {
    setSelectedSwarmPreset(presetName);
    setSwarmAgentList(await api.listSwarmPresetAgents(presetName));
    setEditingSwarmAgentId(null);
    setSwarmAgentForm(toSwarmAgentForm());
  };

  const loadAuditAndUsage = async () => {
    const [logs, usage] = await Promise.all([api.listAuditLogs(50), api.listModelUsage(100)]);
    setAuditLogs(logs);
    setModelUsage(usage);
  };

  const loadToolPolicies = async () => {
    setToolPolicies(await api.listToolPolicies());
  };

  const modelOptions = useMemo(() => {
    const options = new Set<string>();
    settings?.providers?.forEach((provider) => {
      provider.model_options?.forEach((model) => options.add(model));
      if (provider.default_model) options.add(provider.default_model);
    });
    commercialModelProviders.forEach((provider) => {
      if (provider.model) options.add(provider.model);
    });
    if (swarmAgentForm.model_name) options.add(swarmAgentForm.model_name);
    return Array.from(options).sort();
  }, [commercialModelProviders, settings?.providers, swarmAgentForm.model_name]);

  const commercialModelProviderById = useMemo(() => {
    return new Map(commercialModelProviders.map((provider) => [provider.id, provider]));
  }, [commercialModelProviders]);

  const selectedSwarmModelValue = swarmAgentForm.model_provider_id
    ? `provider:${swarmAgentForm.model_provider_id}`
    : swarmAgentForm.model_name
      ? `model:${swarmAgentForm.model_name}`
      : "";

  const setSwarmAgentModel = (value: string) => {
    if (!value) {
      setSwarmAgentForm((prev) => ({ ...prev, model_provider_id: "", model_name: "" }));
      return;
    }
    if (value.startsWith("provider:")) {
      const providerId = value.slice("provider:".length);
      const provider = commercialModelProviderById.get(providerId);
      setSwarmAgentForm((prev) => ({
        ...prev,
        model_provider_id: providerId,
        model_name: provider?.model ?? prev.model_name,
      }));
      return;
    }
    if (value.startsWith("model:")) {
      setSwarmAgentForm((prev) => ({
        ...prev,
        model_provider_id: "",
        model_name: value.slice("model:".length),
      }));
    }
  };

  useEffect(() => {
    let alive = true;

    Promise.allSettled([
      api.getLLMSettings(),
      api.getDataSourceSettings(),
      Promise.all([api.getKnowledgeStats(), api.listKnowledgeDocuments()]),
      api.getChannelStatus(),
      api.getCommercialMe(),
    ])
      .then(async ([llmResult, dataSourceResult, knowledgeResult, channelResult, principalResult]) => {
        if (!alive) return;
        const nextErrors: Record<string, string> = {};

        if (llmResult.status === "fulfilled") {
          setSettings(llmResult.value);
          setForm(toForm(llmResult.value));
          setModelProviderForm(toModelProviderForm(llmResult.value));
        } else {
          const message = llmResult.reason instanceof Error ? llmResult.reason.message : t("settings.unknownError");
          nextErrors.models = message;
          toast.error(isAuthRequiredError(llmResult.reason) ? message : t("settings.loadLlmSettingsFailed", { message }));
        }

        if (dataSourceResult.status === "fulfilled") {
          setDataSettings(dataSourceResult.value);
        } else {
          const message = dataSourceResult.reason instanceof Error ? dataSourceResult.reason.message : t("settings.unknownError");
          nextErrors.data = message;
          toast.error(isAuthRequiredError(dataSourceResult.reason) ? message : t("settings.loadDataSourceSettingsFailed", { message }));
        }

        if (knowledgeResult.status === "fulfilled") {
          setKnowledgeStats(knowledgeResult.value[0]);
          setKnowledgeDocuments(knowledgeResult.value[1]);
        } else {
          const message = knowledgeResult.reason instanceof Error ? knowledgeResult.reason.message : t("settings.unknownError");
          nextErrors.knowledge = message;
          toast.error(t("settings.knowledge.loadFailed", { message }));
        }

        if (channelResult.status === "fulfilled") {
          setChannelStatus(channelResult.value);
        } else {
          const message = channelResult.reason instanceof Error ? channelResult.reason.message : t("settings.unknownError");
          nextErrors.channels = message;
          toast.error(t("settings.channels.refreshFailedWithMessage", { message }));
        }

        if (principalResult.status === "fulfilled") {
          setPrincipal(principalResult.value);
          const currentPrincipal = principalResult.value;
          const commercialLoads = [
            loadCommercialModels(),
            loadCommercialKnowledge(),
            loadAuditAndUsage(),
            loadSwarmPresets(),
            loadToolPolicies(),
          ];
          if (canViewOrganizationMembers(currentPrincipal.role)) {
            commercialLoads.push(loadOrganizationMembers());
          }
          await Promise.allSettled(commercialLoads);
        } else {
          setPrincipal(null);
          setOrganizationMembers([]);
        }

        setLoadErrors(nextErrors);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [t]);

  const refreshChannelStatus = async () => {
    setChannelRefreshing(true);
    try {
      setChannelStatus(await api.getChannelStatus());
      setLoadErrors((prev) => {
        const next = { ...prev };
        delete next.channels;
        return next;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : t("settings.unknownError");
      toast.error(t("settings.channels.refreshFailedWithMessage", { message }));
      setLoadErrors((prev) => ({ ...prev, channels: message }));
    } finally {
      setChannelRefreshing(false);
    }
  };

  const setChannelsRunning = async (action: "start" | "stop") => {
    setChannelAction(action);
    try {
      const updated = action === "start" ? await api.startChannels() : await api.stopChannels();
      setChannelStatus(updated);
      toast.success(action === "start" ? t("settings.channels.started") : t("settings.channels.stoppedToast"));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("settings.unknownError");
      toast.error(action === "start"
        ? t("settings.channels.startFailedWithMessage", { message })
        : t("settings.channels.stopFailedWithMessage", { message }));
    } finally {
      setChannelAction(null);
    }
  };

  const providers = settings?.providers ?? [];
  const selectedProvider = useMemo<LLMProviderOption | undefined>(
    () => providers.find((provider) => provider.name === form?.provider),
    [form?.provider, providers],
  );
  const applyProviderDefaults = (provider = selectedProvider) => {
    if (!provider || !form) return;
    setForm({
      ...form,
      model_name: provider.default_model,
      base_url: provider.default_base_url,
    });
  };

  const onProviderChange = (name: string) => {
    const provider = providers.find((item) => item.name === name);
    if (!provider || !form) return;
    setForm({
      ...form,
      provider: provider.name,
      model_name: provider.default_model,
      base_url: provider.default_base_url,
    });
    setApiKey("");
    setClearApiKey(false);
  };

  const onCommercialProviderChange = (name: string) => {
    const provider = providers.find((item) => item.name === name);
    setModelProviderForm((current) => ({
      ...current,
      provider: provider?.name ?? name,
      model: provider?.default_model ?? current.model,
      base_url: provider?.default_base_url ?? current.base_url,
    }));
  };

  const resetModelProviderForm = () => {
    setEditingModelProviderId(null);
    setModelProviderForm(toModelProviderForm(settings));
  };

  const editModelProvider = (provider: CommercialModelProvider) => {
    setEditingModelProviderId(provider.id);
    setModelProviderForm({
      provider: provider.provider,
      model: provider.model,
      base_url: provider.base_url,
      api_key: "",
      clear_api_key: false,
      temperature: provider.temperature,
      timeout_seconds: provider.timeout_seconds,
      max_retries: provider.max_retries,
      enabled: Boolean(provider.enabled),
      is_default: Boolean(provider.is_default),
    });
  };

  const submitLocalApiKey = (event: FormEvent) => {
    event.preventDefault();
    setApiAuthKey(localApiKey);
    toast.success(t("settings.localApiKeySaved"));
    window.location.reload();
  };

  const createOrganizationMember = async (payload: { email: string; display_name?: string; password: string; role: CommercialRole }) => {
    setMemberSaving(true);
    try {
      await api.createOrganizationMember(payload);
      await loadOrganizationMembers();
      toast.success(t("settings.security.memberCreated"));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("settings.unknownError");
      toast.error(t("settings.security.memberCreateFailed", { message }));
    } finally {
      setMemberSaving(false);
    }
  };

  const updateOrganizationMemberRole = async (member: CommercialOrganizationMember, role: CommercialRole) => {
    if (member.role === role) return;
    setMemberActionId(`role:${member.user_id}`);
    try {
      const updated = await api.updateOrganizationMember(member.user_id, { role });
      setOrganizationMembers((prev) => prev.map((item) => item.user_id === updated.user_id ? updated : item));
      toast.success(t("settings.security.memberUpdated"));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("settings.unknownError");
      toast.error(t("settings.security.memberUpdateFailed", { message }));
    } finally {
      setMemberActionId(null);
    }
  };

  const deleteOrganizationMember = async (member: CommercialOrganizationMember) => {
    if (member.user_id === principal?.user_id) return;
    setMemberActionId(`delete:${member.user_id}`);
    try {
      await api.deleteOrganizationMember(member.user_id);
      setOrganizationMembers((prev) => prev.filter((item) => item.user_id !== member.user_id));
      toast.success(t("settings.security.memberDeleted"));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("settings.unknownError");
      toast.error(t("settings.security.memberDeleteFailed", { message }));
    } finally {
      setMemberActionId(null);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form) return;
    setSaving(true);
    try {
      const updated = await api.updateLLMSettings({
        ...form,
        api_key: apiKey.trim() || undefined,
        clear_api_key: clearApiKey,
      });
      setSettings(updated);
      setForm(toForm(updated));
      setApiKey("");
      setClearApiKey(false);
      toast.success(t("settings.llmSettingsSaved"));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("settings.unknownError");
      toast.error(t("settings.saveLlmSettingsFailed", { message }));
    } finally {
      setSaving(false);
    }
  };

  const submitModelProvider = async (event: FormEvent) => {
    event.preventDefault();
    setModelProviderSaving(true);
    const payload: CommercialModelProviderCreateRequest | CommercialModelProviderUpdateRequest = {
      provider: modelProviderForm.provider,
      model: modelProviderForm.model.trim(),
      base_url: modelProviderForm.base_url.trim(),
      api_key: modelProviderForm.api_key.trim() || undefined,
      clear_api_key: modelProviderForm.clear_api_key,
      temperature: modelProviderForm.temperature,
      timeout_seconds: modelProviderForm.timeout_seconds,
      max_retries: modelProviderForm.max_retries,
      enabled: modelProviderForm.enabled,
      is_default: modelProviderForm.is_default,
    };
    try {
      if (editingModelProviderId) {
        await api.updateCommercialModelProvider(editingModelProviderId, payload);
        toast.success(t("settings.modelProviderActions.updated"));
      } else {
        await api.createCommercialModelProvider(payload as CommercialModelProviderCreateRequest);
        toast.success(t("settings.modelProviderActions.created"));
      }
      resetModelProviderForm();
      await loadCommercialModels();
    } catch (error) {
      const message = error instanceof Error ? error.message : t("settings.unknownError");
      toast.error(t("settings.modelProviderActions.saveFailed", { message }));
    } finally {
      setModelProviderSaving(false);
    }
  };

  const testModelProvider = async (id: string) => {
    setModelProviderTestingId(id);
    try {
      const result = await api.testCommercialModelProvider(id);
      if (result.reachable) {
        toast.success(t("settings.modelProviderActions.testOk"));
      } else {
        toast.error(t("settings.modelProviderActions.testFailed"));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : t("settings.unknownError");
      toast.error(t("settings.modelProviderActions.testFailedWithMessage", { message }));
    } finally {
      setModelProviderTestingId(null);
    }
  };

  const setDefaultModelProvider = async (id: string) => {
    try {
      await api.setDefaultCommercialModelProvider(id);
      await loadCommercialModels();
      toast.success(t("settings.modelProviderActions.defaultUpdated"));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("settings.unknownError");
      toast.error(t("settings.modelProviderActions.defaultFailed", { message }));
    }
  };

  const toggleModelProvider = async (provider: CommercialModelProvider) => {
    try {
      await api.updateCommercialModelProvider(provider.id, { enabled: !Boolean(provider.enabled) });
      await loadCommercialModels();
    } catch (error) {
      const message = error instanceof Error ? error.message : t("settings.unknownError");
      toast.error(t("settings.modelProviderActions.saveFailed", { message }));
    }
  };

  const deleteModelProvider = async (provider: CommercialModelProvider) => {
    try {
      await api.deleteCommercialModelProvider(provider.id);
      await loadCommercialModels();
      toast.success(t("settings.modelProviderActions.deleted"));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("settings.unknownError");
      toast.error(t("settings.modelProviderActions.deleteFailed", { message }));
    }
  };

  const editSwarmAgent = (agent: SwarmPresetAgent) => {
    setEditingSwarmAgentId(agent.id);
    setSwarmAgentForm(toSwarmAgentForm(agent));
  };

  const resetSwarmAgentForm = () => {
    setEditingSwarmAgentId(null);
    setSwarmAgentForm(toSwarmAgentForm());
  };

  const submitSwarmAgent = async (event: FormEvent) => {
    event.preventDefault();
    const payload: SwarmPresetAgentRequest = {
      id: swarmAgentForm.id.trim(),
      role: swarmAgentForm.role.trim(),
      system_prompt: swarmAgentForm.system_prompt.trim(),
      tools: splitList(swarmAgentForm.tools),
      skills: splitList(swarmAgentForm.skills),
      max_iterations: swarmAgentForm.max_iterations,
      timeout_seconds: swarmAgentForm.timeout_seconds,
      model_name: swarmAgentForm.model_name.trim() || null,
      model_provider_id: swarmAgentForm.model_provider_id.trim() || null,
      max_retries: swarmAgentForm.max_retries,
    };
    if (!payload.id) {
      toast.error(t("settings.swarmAgents.idRequired"));
      return;
    }
    setSwarmAgentSaving(true);
    try {
      if (editingSwarmAgentId) {
        await api.updateSwarmPresetAgent(selectedSwarmPreset, editingSwarmAgentId, payload);
        toast.success(t("settings.swarmAgents.updated"));
      } else {
        await api.createSwarmPresetAgent(selectedSwarmPreset, payload);
        toast.success(t("settings.swarmAgents.created"));
      }
      resetSwarmAgentForm();
      await loadSwarmAgents(selectedSwarmPreset);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("settings.unknownError");
      toast.error(t("settings.swarmAgents.saveFailed", { message }));
    } finally {
      setSwarmAgentSaving(false);
    }
  };

  const deleteSwarmAgent = async (agent: SwarmPresetAgent) => {
    setDeletingSwarmAgentId(agent.id);
    try {
      const result = await api.deleteSwarmPresetAgent(selectedSwarmPreset, agent.id);
      await loadSwarmAgents(selectedSwarmPreset);
      toast.success(t("settings.swarmAgents.deleted", { count: result.removed_task_ids.length }));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("settings.unknownError");
      toast.error(t("settings.swarmAgents.deleteFailed", { message }));
    } finally {
      setDeletingSwarmAgentId(null);
    }
  };

  const submitDataSources = async (event: FormEvent) => {
    event.preventDefault();
    setDataSaving(true);
    try {
      const updated = await api.updateDataSourceSettings({
        tushare_token: tushareToken.trim() || undefined,
        clear_tushare_token: clearTushareToken,
      });
      setDataSettings(updated);
      setTushareToken("");
      setClearTushareToken(false);
      toast.success(t("settings.dataSourceSettingsSaved"));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("settings.unknownError");
      toast.error(t("settings.saveDataSourceSettingsFailed", { message }));
    } finally {
      setDataSaving(false);
    }
  };

  const refreshKnowledge = async () => {
    if (principal) {
      await loadCommercialKnowledge(selectedKnowledgeBaseId);
      return;
    }
    const [stats, docs] = await Promise.all([api.getKnowledgeStats(), api.listKnowledgeDocuments()]);
    setKnowledgeStats(stats);
    setKnowledgeDocuments(docs);
  };

  const changeSelectedKnowledgeBase = async (knowledgeBaseId: string) => {
    setSelectedKnowledgeBaseId(knowledgeBaseId);
    const [docs, jobs] = await Promise.all([
      api.listCommercialKnowledgeDocuments(knowledgeBaseId),
      api.listCommercialIngestionJobs(knowledgeBaseId, 20).catch(() => []),
    ]);
    setCommercialDocuments(docs);
    setIngestionJobs(jobs);
  };

  const createDefaultKnowledgeBase = async () => {
    setCreatingKnowledgeBase(true);
    try {
      const kb = await api.createKnowledgeBase({
        name: t("settings.knowledge.defaultKbName"),
        description: t("settings.knowledge.defaultKbDescription"),
      });
      await loadCommercialKnowledge(kb.id);
      toast.success(t("settings.knowledge.kbCreated"));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("settings.unknownError");
      toast.error(t("settings.knowledge.kbCreateFailed", { message }));
    } finally {
      setCreatingKnowledgeBase(false);
    }
  };

  const submitKnowledge = async (event: FormEvent) => {
    event.preventDefault();
    setKnowledgeSaving(true);
    try {
      if (principal) {
        if (!selectedKnowledgeBaseId) {
          throw new Error(t("settings.knowledge.noKnowledgeBase"));
        }
        if (knowledgeFile) {
          const uploaded = await api.uploadFile(knowledgeFile);
          await api.addCommercialKnowledgeDocument(selectedKnowledgeBaseId, {
            path: uploaded.file_path,
            title: knowledgeTitle.trim() || knowledgeFile.name,
          });
        } else if (knowledgeUrl.trim()) {
          await api.addCommercialKnowledgeUrl(selectedKnowledgeBaseId, {
            url: knowledgeUrl.trim(),
            title: knowledgeTitle.trim() || undefined,
          });
        } else if (knowledgePath.trim()) {
          await api.addCommercialKnowledgeDocument(selectedKnowledgeBaseId, {
            path: knowledgePath.trim(),
            title: knowledgeTitle.trim() || undefined,
          });
        } else {
          throw new Error(t("settings.knowledge.sourceRequired"));
        }
      } else {
        if (!knowledgePath.trim()) return;
        await api.addKnowledgeDocument({
          path: knowledgePath.trim(),
          title: knowledgeTitle.trim() || undefined,
        });
      }
      setKnowledgePath("");
      setKnowledgeTitle("");
      setKnowledgeUrl("");
      setKnowledgeFile(null);
      await refreshKnowledge();
      toast.success(t("settings.knowledge.indexed"));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("settings.unknownError");
      toast.error(t("settings.knowledge.indexFailed", { message }));
    } finally {
      setKnowledgeSaving(false);
    }
  };

  const submitKnowledgeSearch = async (event: FormEvent) => {
    event.preventDefault();
    if (!knowledgeQuery.trim()) return;
    setKnowledgeSearching(true);
    try {
      const response = principal && selectedKnowledgeBaseId
        ? await api.searchCommercialKnowledge(selectedKnowledgeBaseId, { query: knowledgeQuery.trim(), limit: 8 })
        : await api.searchKnowledge({ query: knowledgeQuery.trim(), limit: 8 });
      setKnowledgeSearchResults(response.results);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("settings.unknownError");
      toast.error(t("settings.knowledge.searchFailed", { message }));
    } finally {
      setKnowledgeSearching(false);
    }
  };

  const reindexKnowledgeDocument = async (documentId: string) => {
    if (!selectedKnowledgeBaseId) return;
    setKnowledgeJobAction(`reindex:${documentId}`);
    try {
      await api.reindexCommercialKnowledgeDocument(selectedKnowledgeBaseId, documentId);
      await refreshKnowledge();
      toast.success(t("settings.knowledge.reindexStarted"));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("settings.unknownError");
      toast.error(t("settings.knowledge.reindexFailed", { message }));
    } finally {
      setKnowledgeJobAction(null);
    }
  };

  const retryIngestionJob = async (jobId: string) => {
    if (!selectedKnowledgeBaseId) return;
    setKnowledgeJobAction(`retry:${jobId}`);
    try {
      await api.retryCommercialIngestionJob(selectedKnowledgeBaseId, jobId);
      await refreshKnowledge();
      toast.success(t("settings.knowledge.retryStarted"));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("settings.unknownError");
      toast.error(t("settings.knowledge.retryFailed", { message }));
    } finally {
      setKnowledgeJobAction(null);
    }
  };

  const cancelIngestionJob = async (jobId: string) => {
    if (!selectedKnowledgeBaseId) return;
    setKnowledgeJobAction(`cancel:${jobId}`);
    try {
      await api.cancelCommercialIngestionJob(selectedKnowledgeBaseId, jobId);
      await refreshKnowledge();
      toast.success(t("settings.knowledge.cancelled"));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("settings.unknownError");
      toast.error(t("settings.knowledge.cancelFailed", { message }));
    } finally {
      setKnowledgeJobAction(null);
    }
  };

  const updateToolPolicy = async (policy: ToolPolicy, patch: Partial<ToolPolicy>) => {
    setToolPolicySaving(policy.tool_name);
    try {
      const updated = await api.updateToolPolicy(policy.tool_name, {
        risk_level: patch.risk_level,
        permission_scope: patch.permission_scope,
        requires_approval: patch.requires_approval,
        enabled: patch.enabled,
      });
      setToolPolicies((prev) => prev.map((item) => item.tool_name === updated.tool_name ? updated : item));
      toast.success(t("settings.agentPolicy.toolPolicySaved"));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("settings.unknownError");
      toast.error(t("settings.agentPolicy.toolPolicySaveFailed", { message }));
    } finally {
      setToolPolicySaving(null);
    }
  };

  const keyStatus = settings?.api_key_configured
    ? t("settings.configured")
    : settings?.api_key_required
      ? t("settings.keepCurrentKey")
      : selectedProvider?.auth_type === "oauth" && selectedProvider.login_command
        ? t("settings.providerUsesOauth", { command: selectedProvider.login_command })
        : t("settings.noApiKeyRequired");
  const apiKeyDisabled = !selectedProvider?.api_key_required || clearApiKey;
  const tushareStatus = dataSettings?.tushare_token_configured
    ? t("settings.configured")
    : t("settings.keepCurrentToken");
  const renderOverview = () => (
    <SettingsOverviewPanel
      modelName={settings?.model_name}
      provider={settings?.provider}
      documentCount={principal ? commercialDocuments.length : (knowledgeStats?.document_count ?? 0)}
      channelsRunning={Boolean(channelStatus?.running)}
    />
  );

  const renderModelSettings = () => {
    if (!form || !settings) return unavailable(loadErrors.models || t("settings.unavailable"));
    if (principal) {
      return (
        <CommercialModelProvidersPanel
          providers={commercialModelProviders}
          providerOptions={providers}
          form={modelProviderForm}
          editingProviderId={editingModelProviderId}
          saving={modelProviderSaving}
          testingProviderId={modelProviderTestingId}
          onRefresh={loadCommercialModels}
          onEditProvider={editModelProvider}
          onTestProvider={testModelProvider}
          onToggleProvider={toggleModelProvider}
          onSetDefaultProvider={setDefaultModelProvider}
          onDeleteProvider={deleteModelProvider}
          onResetForm={resetModelProviderForm}
          onFormChange={(patch) => setModelProviderForm((prev) => ({ ...prev, ...patch }))}
          onProviderChange={onCommercialProviderChange}
          onSubmit={submitModelProvider}
        />
      );
    }
    return (
      <LocalModelSettingsPanel
        settings={settings}
        form={form}
        providers={providers}
        selectedProvider={selectedProvider}
        apiKey={apiKey}
        clearApiKey={clearApiKey}
        saving={saving}
        keyStatus={keyStatus}
        apiKeyDisabled={apiKeyDisabled}
        onSubmit={submit}
        onProviderChange={onProviderChange}
        onApplyProviderDefaults={() => applyProviderDefaults()}
        onFormChange={(patch) => setForm((prev) => prev ? { ...prev, ...patch } : prev)}
        onApiKeyChange={setApiKey}
        onClearApiKeyChange={(value) => {
          setClearApiKey(value);
          if (value) setApiKey("");
        }}
      />
    );
  };

  const renderKnowledge = () => (
    <KnowledgeSettingsPanel
      principal={principal}
      loadError={loadErrors.knowledge || ""}
      knowledgeStats={knowledgeStats}
      localDocuments={knowledgeDocuments}
      knowledgeBases={knowledgeBases}
      selectedKnowledgeBaseId={selectedKnowledgeBaseId}
      backendStatus={knowledgeBackendStatus}
      commercialDocuments={commercialDocuments}
      ingestionJobs={ingestionJobs}
      searchResults={knowledgeSearchResults}
      knowledgeTitle={knowledgeTitle}
      knowledgePath={knowledgePath}
      knowledgeUrl={knowledgeUrl}
      knowledgeQuery={knowledgeQuery}
      hasKnowledgeFile={Boolean(knowledgeFile)}
      creatingKnowledgeBase={creatingKnowledgeBase}
      knowledgeSaving={knowledgeSaving}
      knowledgeSearching={knowledgeSearching}
      knowledgeJobAction={knowledgeJobAction}
      onRefresh={refreshKnowledge}
      onCreateDefaultKnowledgeBase={createDefaultKnowledgeBase}
      onKnowledgeBaseChange={changeSelectedKnowledgeBase}
      onTitleChange={setKnowledgeTitle}
      onPathChange={setKnowledgePath}
      onUrlChange={setKnowledgeUrl}
      onQueryChange={setKnowledgeQuery}
      onFileChange={setKnowledgeFile}
      onSubmitKnowledge={submitKnowledge}
      onSubmitSearch={submitKnowledgeSearch}
      onReindexDocument={reindexKnowledgeDocument}
      onRetryJob={retryIngestionJob}
      onCancelJob={cancelIngestionJob}
    />
  );

  const renderDataSources = () => {
    if (!dataSettings) return unavailable(loadErrors.data || t("settings.unavailable"));
    return (
      <DataSourceSettingsPanel
        dataSettings={dataSettings}
        tushareToken={tushareToken}
        clearTushareToken={clearTushareToken}
        saving={dataSaving}
        tushareStatus={tushareStatus}
        onSubmit={submitDataSources}
        onTushareTokenChange={setTushareToken}
        onClearTushareTokenChange={(value) => {
          setClearTushareToken(value);
          if (value) setTushareToken("");
        }}
      />
    );
  };

  const renderAgentPolicy = () => (
    <div className="space-y-5">
      <AgentPolicyPanel
        principal={principal}
        toolPolicies={toolPolicies}
        toolPolicySaving={toolPolicySaving}
        onRefreshToolPolicies={loadToolPolicies}
        onUpdateToolPolicy={updateToolPolicy}
      />
      <SwarmAgentsPanel
        presets={swarmPresets}
        selectedPreset={selectedSwarmPreset}
        agentList={swarmAgentList}
        form={swarmAgentForm}
        editingAgentId={editingSwarmAgentId}
        saving={swarmAgentSaving}
        deletingAgentId={deletingSwarmAgentId}
        commercialModelProviders={commercialModelProviders}
        modelOptions={modelOptions}
        selectedModelValue={selectedSwarmModelValue}
        onRefresh={loadSwarmPresets}
        onPresetChange={loadSwarmAgents}
        onResetForm={resetSwarmAgentForm}
        onEditAgent={editSwarmAgent}
        onDeleteAgent={deleteSwarmAgent}
        onSubmit={submitSwarmAgent}
        onFormChange={(patch) => setSwarmAgentForm((prev) => ({ ...prev, ...patch }))}
        onModelChange={setSwarmAgentModel}
      />
    </div>
  );

  const renderSecurity = () => (
    <OrganizationSecurityPanel
      principal={principal}
      localApiKey={localApiKey}
      onLocalApiKeyChange={setLocalApiKeyState}
      onSubmitLocalApiKey={submitLocalApiKey}
      organizationMembers={organizationMembers}
      memberSaving={memberSaving}
      memberActionId={memberActionId}
      onReloadMembers={async () => {
        try {
          await loadOrganizationMembers();
        } catch (error) {
          toast.error(t("settings.security.memberLoadFailed", { message: error instanceof Error ? error.message : t("settings.unknownError") }));
        }
      }}
      onCreateMember={createOrganizationMember}
      onUpdateMemberRole={updateOrganizationMemberRole}
      onDeleteMember={deleteOrganizationMember}
    />
  );

  const renderChannels = () => (
    <ChannelsSettingsPanel
      channelStatus={channelStatus}
      loadError={loadErrors.channels || ""}
      refreshing={channelRefreshing}
      action={channelAction}
      onRefresh={refreshChannelStatus}
      onSetRunning={setChannelsRunning}
    />
  );

  const renderRuntime = () => <RuntimeSettingsPanel />;

  const renderAudit = () => (
    <AuditUsagePanel
      auditLogs={auditLogs}
      modelUsage={modelUsage}
      onRefresh={loadAuditAndUsage}
    />
  );

  const renderActiveSection = () => {
    switch (activeSection) {
      case "overview": return renderOverview();
      case "models": return renderModelSettings();
      case "knowledge": return renderKnowledge();
      case "data": return renderDataSources();
      case "agent": return renderAgentPolicy();
      case "security": return renderSecurity();
      case "channels": return renderChannels();
      case "runtime": return renderRuntime();
      case "audit": return renderAudit();
      default: return renderOverview();
    }
  };

  const activeMeta = SETTINGS_SECTIONS.find((section) => section.id === activeSection) ?? SETTINGS_SECTIONS[0];
  const ActiveIcon = activeMeta.icon;
  const tr = (key: string) => t(key as never);

  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-6 space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("settings.title")}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">{t("settings.subtitle")}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="rounded-lg border bg-card p-2 shadow-sm">
          <nav className="space-y-1">
            {SETTINGS_SECTIONS.map(({ id, icon: Icon, labelKey, descKey }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-md px-3 py-3 text-left transition",
                  activeSection === id
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <span className="block text-sm font-medium">{tr(labelKey)}</span>
                  <span className="mt-0.5 block text-xs opacity-80">{tr(descKey)}</span>
                </span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 space-y-5">
          <div className="rounded-lg border bg-muted/20 p-4">
            <div className="flex items-center gap-2">
              <ActiveIcon className="h-4 w-4 text-primary" />
              <h2 className="text-base font-semibold">{tr(activeMeta.labelKey)}</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{tr(activeMeta.descKey)}</p>
            {loading ? (
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t("settings.loading")}
              </div>
            ) : null}
          </div>
          {renderActiveSection()}
        </main>
      </div>
    </div>
  );
}

