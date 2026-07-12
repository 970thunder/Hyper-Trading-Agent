import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Activity,
  BarChart3,
  Brain,
  ClipboardList,
  Database,
  KeyRound,
  Loader2,
  MessageSquareMore,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Trash2,
} from "lucide-react";
import type { TFunction } from "i18next";
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

interface LLMFormState {
  provider: string;
  model_name: string;
  base_url: string;
  temperature: number;
  timeout_seconds: number;
  max_retries: number;
  reasoning_effort: string;
}

interface ModelProviderFormState {
  provider: string;
  model: string;
  base_url: string;
  api_key: string;
  clear_api_key: boolean;
  temperature: number;
  timeout_seconds: number;
  max_retries: number;
  enabled: boolean;
  is_default: boolean;
}

interface SwarmAgentFormState {
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

interface OrganizationMemberFormState {
  email: string;
  display_name: string;
  password: string;
  role: CommercialRole;
}

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

const fieldClass =
  "w-full rounded-md border border-border/75 bg-background px-3 py-2 text-sm outline-none transition focus:border-primary/70 focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60";
const labelClass = "text-sm font-medium";
const hintClass = "text-xs text-muted-foreground";
const sectionCardClass = "rounded-lg border border-border/70 bg-card p-5 shadow-sm";

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

function emptyMemberForm(): OrganizationMemberFormState {
  return {
    email: "",
    display_name: "",
    password: "",
    role: "member",
  };
}

function swarmPresetDisplayName(t: TFunction, preset: SwarmPreset): string {
  return t(`settings.swarmPresetNames.${preset.name}`, { defaultValue: preset.title || preset.name });
}

function swarmAgentRoleDisplayName(
  t: TFunction,
  presetName: string,
  agent: Pick<SwarmPresetAgent, "id" | "role">,
): string {
  return t(`settings.swarmAgentRoles.${presetName}.${agent.id}`, { defaultValue: agent.role || agent.id });
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
  const [memberForm, setMemberForm] = useState<OrganizationMemberFormState>(() => emptyMemberForm());
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
  const canManageOrganizationMembers = principal?.role === "owner";

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

  const swarmAgentModelLabel = (agent: SwarmPresetAgent) => {
    if (agent.model_provider_id) {
      const provider = commercialModelProviderById.get(agent.model_provider_id);
      if (provider) {
        return `${provider.provider} / ${provider.model}${provider.is_default ? ` (${t("settings.modelProviders.default")})` : ""}`;
      }
      return agent.model_name
        ? `${agent.model_name} (${agent.model_provider_id})`
        : agent.model_provider_id;
    }
    return agent.model_name || t("settings.swarmAgents.defaultModel");
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
  const modelOptionsFor = (provider?: LLMProviderOption, currentModel?: string) => {
    const values = provider?.model_options?.length
      ? provider.model_options
      : provider?.default_model
        ? [provider.default_model]
        : [];
    const merged = currentModel && !values.includes(currentModel) ? [currentModel, ...values] : values;
    return Array.from(new Set(merged.filter(Boolean)));
  };

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

  const submitOrganizationMember = async (event: FormEvent) => {
    event.preventDefault();
    if (!canManageOrganizationMembers) return;
    if (!memberForm.email.trim() || !memberForm.password.trim()) {
      toast.error(t("settings.security.memberRequired"));
      return;
    }
    setMemberSaving(true);
    try {
      await api.createOrganizationMember({
        email: memberForm.email.trim(),
        display_name: memberForm.display_name.trim() || undefined,
        password: memberForm.password,
        role: memberForm.role,
      });
      setMemberForm(emptyMemberForm());
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
    if (!canManageOrganizationMembers || member.role === role) return;
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
    if (!canManageOrganizationMembers || member.user_id === principal?.user_id) return;
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
  const channelRows = channelStatus
    ? Object.entries(channelStatus.channels ?? {}).sort(([a], [b]) => a.localeCompare(b))
    : [];
  const channelEnabledCount = channelRows.filter(([, item]) => item.enabled).length;
  const channelLoadedCount = channelRows.filter(([, item]) => item.loaded).length;
  const channelUnavailableCount = channelRows.filter(([, item]) => item.available === false).length;
  const channelBusy = channelRefreshing || channelAction !== null;
  const totalTokens = modelUsage.reduce((sum, item) => sum + (item.total_tokens || 0), 0);
  const totalCost = modelUsage.reduce((sum, item) => sum + (item.estimated_cost || 0), 0);
  const usageByDate = modelUsage.reduce<Record<string, number>>((acc, item) => {
    const date = item.created_at.slice(0, 10);
    acc[date] = (acc[date] || 0) + (item.total_tokens || 0);
    return acc;
  }, {});
  const usageBars = Object.entries(usageByDate).sort(([a], [b]) => a.localeCompare(b)).slice(-7);
  const maxUsageBar = Math.max(1, ...usageBars.map(([, value]) => value));
  const channelConfigHint = (name: string) => {
    const key = name.toLowerCase();
    if (key === "telegram") return "channels.telegram.enabled / botToken / allowUsers";
    if (key === "discord") return "channels.discord.enabled / botToken / allowChannels";
    if (key === "feishu") return "channels.feishu.enabled / appId / appSecret";
    if (key === "dingtalk") return "channels.dingtalk.enabled / clientId / clientSecret";
    if (key === "email") return "channels.email.enabled / imapHost / smtpHost";
    if (key === "websocket") return "channels.websocket.enabled / host / port";
    if (key === "wecom") return "channels.wecom.enabled / clientId / clientSecret";
    if (key === "weixin") return "channels.weixin.enabled";
    if (key === "whatsapp") return "channels.whatsapp.enabled";
    if (key === "signal") return "channels.signal.enabled";
    return `channels.${key}.enabled`;
  };

  const renderOverview = () => (
    <section className={sectionCardClass}>
      <div className="mb-5 space-y-1">
        <h2 className="text-base font-semibold">{t("settings.overview.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("settings.overview.description")}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label={t("settings.overview.model")} value={settings?.model_name || t("settings.unavailable")} />
        <MetricCard label={t("settings.overview.provider")} value={settings?.provider || t("settings.unavailable")} />
        <MetricCard label={t("settings.overview.documents")} value={String(principal ? commercialDocuments.length : (knowledgeStats?.document_count ?? 0))} />
        <MetricCard label={t("settings.overview.channels")} value={channelStatus?.running ? t("settings.channels.running") : t("settings.channels.stopped")} />
      </div>
    </section>
  );

  const renderModelSettings = () => {
    if (!form || !settings) return unavailable(loadErrors.models || t("settings.unavailable"));
    if (principal) {
      const selectedCommercialProvider = providers.find((item) => item.name === modelProviderForm.provider);
      return (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.65fr)]">
          <section className={sectionCardClass}>
            <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 text-primary" />
                  <h2 className="text-base font-semibold">{t("settings.modelProviders.title")}</h2>
                </div>
                <p className="text-sm text-muted-foreground">{t("settings.modelProviders.description")}</p>
              </div>
              <button type="button" onClick={() => loadCommercialModels().catch((error) => toast.error(error instanceof Error ? error.message : t("settings.unknownError")))} className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground">
                <RefreshCw className="h-4 w-4" />
                {t("settings.refresh")}
              </button>
            </div>

            {commercialModelProviders.length === 0 ? (
              <div className="rounded-lg border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
                {t("settings.modelProviders.empty")}
              </div>
            ) : (
              <div className="grid gap-3">
                {commercialModelProviders.map((provider) => (
                  <div key={provider.id} className="rounded-lg border border-border/70 bg-background p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-semibold">{provider.model}</span>
                          <StatusPill active={Boolean(provider.enabled)} on={t("settings.modelProviders.enabled")} off={t("settings.modelProviders.disabled")} />
                          {Boolean(provider.is_default) ? (
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                              {t("settings.modelProviders.default")}
                            </span>
                          ) : null}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {provider.provider} · {provider.base_url}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {t("settings.modelProviders.params", {
                            temperature: provider.temperature,
                            timeout: provider.timeout_seconds,
                            retries: provider.max_retries,
                          })}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => editModelProvider(provider)} className="rounded-md border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground">
                          {t("settings.modelProviderActions.edit")}
                        </button>
                        <button type="button" onClick={() => testModelProvider(provider.id)} disabled={modelProviderTestingId === provider.id} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50">
                          {modelProviderTestingId === provider.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                          {t("settings.modelProviderActions.test")}
                        </button>
                        <button type="button" onClick={() => toggleModelProvider(provider)} disabled={Boolean(provider.is_default) && Boolean(provider.enabled)} className="rounded-md border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50">
                          {Boolean(provider.enabled) ? t("settings.modelProviderActions.disable") : t("settings.modelProviderActions.enable")}
                        </button>
                        <button type="button" onClick={() => setDefaultModelProvider(provider.id)} disabled={Boolean(provider.is_default) || !Boolean(provider.enabled)} className="rounded-md border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50">
                          {t("settings.modelProviderActions.setDefault")}
                        </button>
                        <button type="button" onClick={() => deleteModelProvider(provider)} disabled={Boolean(provider.is_default)} className="rounded-md border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-destructive/40 hover:text-destructive disabled:opacity-50">
                          {t("settings.modelProviderActions.delete")}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <form onSubmit={submitModelProvider} className={sectionCardClass}>
            <div className="mb-5 flex items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4 text-primary" />
                  <h2 className="text-base font-semibold">
                    {editingModelProviderId ? t("settings.modelProviderForm.editTitle") : t("settings.modelProviderForm.createTitle")}
                  </h2>
                </div>
                <p className="text-sm text-muted-foreground">{t("settings.modelProviderForm.description")}</p>
              </div>
              {editingModelProviderId ? (
                <button type="button" onClick={resetModelProviderForm} className="rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground">
                  {t("settings.modelProviderActions.cancelEdit")}
                </button>
              ) : null}
            </div>

            <div className="grid gap-4">
              <label className="grid gap-2">
                <span className={labelClass}>{t("settings.provider")}</span>
                <select value={modelProviderForm.provider} onChange={(event) => onCommercialProviderChange(event.target.value)} className={fieldClass}>
                  {providers.map((provider) => (
                    <option key={provider.name} value={provider.name}>{provider.label}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-2">
                <span className={labelClass}>{t("settings.model")}</span>
                <select
                  value={modelProviderForm.model}
                  onChange={(event) => setModelProviderForm({ ...modelProviderForm, model: event.target.value })}
                  className={fieldClass}
                  required
                >
                  {modelOptionsFor(selectedCommercialProvider, modelProviderForm.model).map((model) => (
                    <option key={model} value={model}>{model}</option>
                  ))}
                </select>
                <span className={hintClass}>{t("settings.modelIdHint")}</span>
              </label>
              <label className="grid gap-2">
                <span className={labelClass}>{t("settings.baseUrl")}</span>
                <div className="flex gap-2">
                  <input value={modelProviderForm.base_url} onChange={(event) => setModelProviderForm({ ...modelProviderForm, base_url: event.target.value })} className={fieldClass} placeholder={selectedCommercialProvider?.default_base_url} />
                  <button
                    type="button"
                    onClick={() => setModelProviderForm({
                      ...modelProviderForm,
                      model: selectedCommercialProvider?.default_model ?? modelProviderForm.model,
                      base_url: selectedCommercialProvider?.default_base_url ?? modelProviderForm.base_url,
                    })}
                    className="inline-flex shrink-0 items-center rounded-md border px-3 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                    title={t("settings.useProviderDefaults")}
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                </div>
              </label>
              <TextField label="API key" value={modelProviderForm.api_key} onChange={(value) => setModelProviderForm({ ...modelProviderForm, api_key: value, clear_api_key: false })} type="password" placeholder={editingModelProviderId ? t("settings.modelProviderForm.keepExistingKey") : ""} />
              {editingModelProviderId ? (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={modelProviderForm.clear_api_key} onChange={(event) => setModelProviderForm({ ...modelProviderForm, clear_api_key: event.target.checked, api_key: event.target.checked ? "" : modelProviderForm.api_key })} className="h-3.5 w-3.5 accent-primary" />
                  {t("settings.clearApiKey")}
                </label>
              ) : null}
              <div className="grid grid-cols-3 gap-3">
                <NumberField label={t("settings.temperature")} value={modelProviderForm.temperature} min={0} max={2} step={0.1} onChange={(value) => setModelProviderForm({ ...modelProviderForm, temperature: value })} />
                <NumberField label={t("settings.timeoutSeconds")} value={modelProviderForm.timeout_seconds} min={1} max={3600} step={1} onChange={(value) => setModelProviderForm({ ...modelProviderForm, timeout_seconds: value })} />
                <NumberField label={t("settings.maxRetries")} value={modelProviderForm.max_retries} min={0} max={20} step={1} onChange={(value) => setModelProviderForm({ ...modelProviderForm, max_retries: value })} />
              </div>
              <div className="grid gap-2 rounded-md border bg-muted/20 p-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={modelProviderForm.enabled} onChange={(event) => setModelProviderForm({ ...modelProviderForm, enabled: event.target.checked })} className="h-4 w-4 accent-primary" />
                  {t("settings.modelProviders.enabled")}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={modelProviderForm.is_default} onChange={(event) => setModelProviderForm({ ...modelProviderForm, is_default: event.target.checked })} className="h-4 w-4 accent-primary" />
                  {t("settings.modelProviderForm.makeDefault")}
                </label>
              </div>
              <PrimaryButton type="submit" disabled={modelProviderSaving || !modelProviderForm.model.trim() || !modelProviderForm.base_url.trim()} loading={modelProviderSaving} label={editingModelProviderId ? t("settings.modelProviderActions.update") : t("settings.modelProviderActions.create")} />
            </div>
          </form>
        </div>
      );
    }
    return (
      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.75fr)]">
        <section className={sectionCardClass}>
          <div className="mb-5 flex items-center gap-2">
            <Server className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">{t("settings.connection")}</h2>
          </div>

          <div className="grid gap-4">
            <label className="grid gap-2">
              <span className={labelClass}>{t("settings.provider")}</span>
              <select value={form.provider} onChange={(event) => onProviderChange(event.target.value)} className={fieldClass}>
                {providers.map((provider) => (
                  <option key={provider.name} value={provider.name}>{provider.label}</option>
                ))}
              </select>
              <span className={hintClass}>{t("settings.modelProviderHint")}</span>
            </label>

            <label className="grid gap-2">
              <span className={labelClass}>{t("settings.model")}</span>
              <div className="flex gap-2">
                <select value={form.model_name} onChange={(event) => setForm({ ...form, model_name: event.target.value })} className={fieldClass} required>
                  {modelOptionsFor(selectedProvider, form.model_name).map((model) => (
                    <option key={model} value={model}>{model}</option>
                  ))}
                </select>
                <button type="button" onClick={() => applyProviderDefaults()} className="inline-flex shrink-0 items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground" title={t("settings.useProviderDefaults")}>
                  <RotateCcw className="h-4 w-4" />
                  <span className="hidden sm:inline">{t("settings.useProviderDefaults")}</span>
                </button>
              </div>
              <span className={hintClass}>{t("settings.modelIdHint")}</span>
            </label>

            <label className="grid gap-2">
              <span className={labelClass}>{t("settings.baseUrl")}</span>
              <input value={form.base_url} onChange={(event) => setForm({ ...form, base_url: event.target.value })} className={fieldClass} placeholder={selectedProvider?.default_base_url} disabled={selectedProvider?.auth_type === "oauth"} />
            </label>

            <label className="grid gap-2">
              <span className={labelClass}>{selectedProvider?.auth_type === "oauth" ? "OAuth" : "API key"}</span>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} className={`${fieldClass} pl-9`} placeholder={keyStatus} autoComplete="current-password" disabled={apiKeyDisabled} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className={hintClass}>{keyStatus}</span>
                {selectedProvider?.api_key_required ? (
                  <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={clearApiKey} onChange={(event) => {
                      setClearApiKey(event.target.checked);
                      if (event.target.checked) setApiKey("");
                    }} className="h-3.5 w-3.5 accent-primary" />
                    {t("settings.clearApiKey")}
                  </label>
                ) : null}
              </div>
            </label>
          </div>
        </section>

        <section className={sectionCardClass}>
          <div className="mb-5 flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">{t("settings.generation")}</h2>
          </div>
          <div className="grid gap-4">
            <NumberField label={t("settings.temperature")} value={form.temperature} min={0} max={2} step={0.1} onChange={(value) => setForm({ ...form, temperature: value })} />
            <NumberField label={t("settings.timeoutSeconds")} value={form.timeout_seconds} min={1} max={3600} step={1} onChange={(value) => setForm({ ...form, timeout_seconds: value })} />
            <NumberField label={t("settings.maxRetries")} value={form.max_retries} min={0} max={20} step={1} onChange={(value) => setForm({ ...form, max_retries: value })} />

            <label className="grid gap-2">
              <span className={labelClass}>{t("settings.reasoningEffort")}</span>
              <select value={form.reasoning_effort} onChange={(event) => setForm({ ...form, reasoning_effort: event.target.value })} className={fieldClass}>
                <option value="">{t("settings.off")}</option>
                <option value="low">{t("settings.reasoningEffortLow")}</option>
                <option value="medium">{t("settings.reasoningEffortMedium")}</option>
                <option value="high">{t("settings.reasoningEffortHigh")}</option>
                <option value="max">{t("settings.reasoningEffortMax")}</option>
              </select>
              <span className={hintClass}>{t("settings.reasoningEffortDesc")}</span>
            </label>

            <EnvPath value={settings.env_path} />
            <PrimaryButton type="submit" disabled={saving} loading={saving} label={saving ? t("settings.saving") : t("settings.save")} />
          </div>
        </section>
      </form>
    );
  };

  const renderKnowledge = () => (
    <section className={sectionCardClass}>
      <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">{t("settings.knowledge.title")}</h2>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">{t("settings.knowledge.description")}</p>
        </div>
        <button type="button" onClick={() => refreshKnowledge().catch((error) => toast.error(t("settings.knowledge.refreshFailed", { message: error instanceof Error ? error.message : t("settings.unknownError") })))} className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground">
          <RefreshCw className="h-4 w-4" />
          {t("settings.refresh")}
        </button>
      </div>

      {principal ? (
        <>
          <div className="mb-5 grid gap-3 md:grid-cols-5">
            <MetricCard label={t("settings.knowledge.mode")} value={t("settings.knowledge.commercialMode")} />
            <MetricCard label={t("settings.knowledge.knowledgeBases")} value={String(knowledgeBases.length)} />
            <MetricCard label={t("settings.knowledge.documents")} value={String(commercialDocuments.length)} />
            <MetricCard label={t("settings.knowledge.retrieval")} value={t("settings.knowledge.hybridRetrieval")} />
            <MetricCard
              label={t("settings.knowledge.embedding")}
              value={knowledgeBackendStatus?.primary.available ? knowledgeBackendStatus.primary.provider : t("settings.knowledge.localFallback")}
              title={knowledgeBackendStatus?.primary.available ? knowledgeBackendStatus.primary.model : knowledgeBackendStatus?.fallback.model}
            />
          </div>

          {knowledgeBases.length ? (
            <div className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
              <label className="grid gap-2">
                <span className={labelClass}>{t("settings.knowledge.selectKb")}</span>
                <select
                  value={selectedKnowledgeBaseId}
                  onChange={(event) => {
                    const nextId = event.target.value;
                    setSelectedKnowledgeBaseId(nextId);
                    api.listCommercialKnowledgeDocuments(nextId)
                      .then(setCommercialDocuments)
                      .catch((error) => toast.error(t("settings.knowledge.refreshFailed", { message: error instanceof Error ? error.message : t("settings.unknownError") })));
                  }}
                  className={fieldClass}
                >
                  {knowledgeBases.map((kb) => (
                    <option key={kb.id} value={kb.id}>{kb.name}</option>
                  ))}
                </select>
              </label>
              <div className="grid gap-2 rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
                <span>{t("settings.knowledge.pipelineDescription")}</span>
                {knowledgeBackendStatus ? (
                  <span>
                    {knowledgeBackendStatus.primary.available
                      ? t("settings.knowledge.embeddingProviderReady", {
                        provider: knowledgeBackendStatus.primary.provider,
                        model: knowledgeBackendStatus.primary.model,
                      })
                      : t("settings.knowledge.embeddingFallbackActive", {
                        provider: knowledgeBackendStatus.primary.provider,
                        model: knowledgeBackendStatus.fallback.model,
                      })}
                  </span>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="mb-5 rounded-md border bg-muted/20 p-4">
              <p className="text-sm text-muted-foreground">{t("settings.knowledge.noKnowledgeBaseHint")}</p>
              <button type="button" onClick={createDefaultKnowledgeBase} disabled={creatingKnowledgeBase} className="mt-3 inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
                {creatingKnowledgeBase ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
                {t("settings.knowledge.createDefaultKb")}
              </button>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <form onSubmit={submitKnowledge} className="grid gap-4 rounded-md border bg-muted/10 p-4">
              <TextField label={t("settings.knowledge.documentTitle")} value={knowledgeTitle} onChange={setKnowledgeTitle} placeholder={t("settings.optional")} />
              <label className="grid gap-2">
                <span className={labelClass}>{t("settings.knowledge.uploadFile")}</span>
                <input
                  type="file"
                  onChange={(event) => setKnowledgeFile(event.target.files?.[0] ?? null)}
                  className={fieldClass}
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.md,.txt,.html,.htm,.csv,.tsv,.json,.yaml,.yml"
                />
                <span className={hintClass}>{t("settings.knowledge.fileTypes")}</span>
              </label>
              <TextField label={t("settings.knowledge.documentPath")} value={knowledgePath} onChange={setKnowledgePath} placeholder="uploads/research-notes.md" />
              <TextField label={t("settings.knowledge.url")} value={knowledgeUrl} onChange={setKnowledgeUrl} placeholder="https://example.com/research.html" />
              <PrimaryButton type="submit" disabled={knowledgeSaving || !selectedKnowledgeBaseId || (!knowledgeFile && !knowledgePath.trim() && !knowledgeUrl.trim())} loading={knowledgeSaving} label={t("settings.knowledge.index")} />
            </form>

            <div className="rounded-md border bg-muted/10 p-4">
              <form onSubmit={submitKnowledgeSearch} className="grid gap-3">
                <TextField label={t("settings.knowledge.searchTest")} value={knowledgeQuery} onChange={setKnowledgeQuery} placeholder={t("settings.knowledge.searchPlaceholder")} />
                <PrimaryButton type="submit" disabled={knowledgeSearching || !knowledgeQuery.trim() || !selectedKnowledgeBaseId} loading={knowledgeSearching} label={t("settings.knowledge.search")} />
              </form>
              <SearchResults results={knowledgeSearchResults} emptyLabel={t("settings.knowledge.noSearchResults")} />
            </div>
          </div>

          {ingestionJobs.length ? (
            <div className="mt-5 overflow-hidden rounded-md border">
              <div className="border-b bg-muted/20 px-3 py-2 text-sm font-semibold">{t("settings.knowledge.ingestionJobs")}</div>
              <div className="divide-y">
                {ingestionJobs.slice(0, 6).map((job) => (
                  <div key={job.id} className="grid gap-3 px-3 py-3 text-sm md:grid-cols-[minmax(0,1fr)_120px_100px_auto] md:items-center">
                    <div className="min-w-0">
                      <div className="truncate font-medium" title={job.document_id || job.id}>{job.document_id || job.id}</div>
                      <div className="mt-1 truncate text-xs text-muted-foreground" title={job.error || job.updated_at}>{job.error || job.updated_at}</div>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div className="h-full bg-primary transition-all" style={{ width: `${Math.max(0, Math.min(100, Number(job.progress || 0)))}%` }} />
                    </div>
                    <div className="text-xs text-muted-foreground">{job.status} · {Number(job.progress || 0)}%</div>
                    <div className="flex justify-end gap-2">
                      {job.status === "failed" ? (
                        <button type="button" onClick={() => retryIngestionJob(job.id)} disabled={knowledgeJobAction === `retry:${job.id}`} className="rounded-md border px-2 py-1 text-xs transition hover:bg-muted disabled:opacity-60">
                          {knowledgeJobAction === `retry:${job.id}` ? t("settings.loading") : t("settings.knowledge.retry")}
                        </button>
                      ) : null}
                      {job.status === "pending" || job.status === "running" ? (
                        <button type="button" onClick={() => cancelIngestionJob(job.id)} disabled={knowledgeJobAction === `cancel:${job.id}`} className="rounded-md border px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted disabled:opacity-60">
                          {t("settings.knowledge.cancel")}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {commercialDocuments.length ? (
            <KnowledgeDocumentTable
              rows={commercialDocuments.map((doc) => ({
                id: doc.id,
                title: doc.title,
                chunkCount: doc.chunk_count,
                source: doc.source_uri,
                status: doc.status,
                ingestionStatus: doc.ingestion_status || "",
                ingestionProgress: Number(doc.ingestion_progress || 0),
                ingestionError: doc.ingestion_error || "",
              }))}
              titleLabel={t("settings.knowledge.documentTitle")}
              chunksLabel={t("settings.knowledge.chunks")}
              sourceLabel={t("settings.knowledge.source")}
              statusLabel={t("settings.status")}
              actionsLabel={t("settings.swarmAgents.actions")}
              reindexLabel={t("settings.knowledge.reindex")}
              loadingLabel={t("settings.loading")}
              actionBusyId={knowledgeJobAction}
              onReindex={reindexKnowledgeDocument}
            />
          ) : (
            <div className="mt-5 rounded-md border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
              {t("settings.knowledge.empty")}
            </div>
          )}
        </>
      ) : knowledgeStats ? (
        <>
          <div className="mb-5 grid gap-3 md:grid-cols-3">
            <MetricCard label={t("settings.knowledge.documents")} value={String(knowledgeStats.document_count)} />
            <MetricCard label={t("settings.knowledge.chunks")} value={String(knowledgeStats.chunk_count)} />
            <MetricCard label={t("settings.knowledge.storage")} value={knowledgeStats.db_path} title={knowledgeStats.db_path} />
          </div>
          <form onSubmit={submitKnowledge} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(220px,0.45fr)_auto]">
            <TextField label={t("settings.knowledge.documentPath")} value={knowledgePath} onChange={setKnowledgePath} placeholder="uploads/research-notes.md" />
            <TextField label={t("settings.knowledge.documentTitle")} value={knowledgeTitle} onChange={setKnowledgeTitle} placeholder={t("settings.optional")} />
            <PrimaryButton type="submit" disabled={knowledgeSaving || !knowledgePath.trim()} loading={knowledgeSaving} label={t("settings.knowledge.index")} className="self-end" />
          </form>
          <form onSubmit={submitKnowledgeSearch} className="mt-5 grid gap-4 rounded-md border bg-muted/10 p-4 lg:grid-cols-[minmax(0,1fr)_auto]">
            <TextField label={t("settings.knowledge.searchTest")} value={knowledgeQuery} onChange={setKnowledgeQuery} placeholder={t("settings.knowledge.searchPlaceholder")} />
            <PrimaryButton type="submit" disabled={knowledgeSearching || !knowledgeQuery.trim()} loading={knowledgeSearching} label={t("settings.knowledge.search")} className="self-end" />
          </form>
          <SearchResults results={knowledgeSearchResults} emptyLabel={t("settings.knowledge.noSearchResults")} />
          {knowledgeDocuments.length ? (
            <KnowledgeDocumentTable
              rows={knowledgeDocuments.slice(0, 8).map((doc) => ({
                id: doc.id,
                title: doc.title,
                chunkCount: doc.chunk_count,
                source: doc.source_path,
                status: t("settings.knowledge.ready"),
              }))}
              titleLabel={t("settings.knowledge.documentTitle")}
              chunksLabel={t("settings.knowledge.chunks")}
              sourceLabel={t("settings.knowledge.source")}
              statusLabel={t("settings.status")}
            />
          ) : (
            <div className="mt-5 rounded-md border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
              {t("settings.knowledge.empty")}
            </div>
          )}
        </>
      ) : unavailable(loadErrors.knowledge || t("settings.unavailable"))}
    </section>
  );

  const renderDataSources = () => {
    if (!dataSettings) return unavailable(loadErrors.data || t("settings.unavailable"));
    return (
      <form onSubmit={submitDataSources} className={sectionCardClass}>
        <div className="mb-5 space-y-1">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">{t("settings.dataSourceSettings")}</h2>
          </div>
          <p className="text-sm text-muted-foreground">{t("settings.dataSourceSettingsDesc")}</p>
        </div>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
          <div className="grid gap-4">
            <label className="grid gap-2">
              <span className={labelClass}>{t("settings.tushareToken")}</span>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <input type="password" value={tushareToken} onChange={(event) => setTushareToken(event.target.value)} className={`${fieldClass} pl-9`} placeholder={tushareStatus} autoComplete="current-password" disabled={clearTushareToken} />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className={hintClass}>{t("settings.data.tushareHint")}</span>
                <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={clearTushareToken} onChange={(event) => {
                    setClearTushareToken(event.target.checked);
                    if (event.target.checked) setTushareToken("");
                  }} className="h-3.5 w-3.5 accent-primary" />
                  {t("settings.clearTushareToken")}
                </label>
              </div>
            </label>
            <EnvPath value={dataSettings.env_path} />
            <PrimaryButton type="submit" disabled={dataSaving} loading={dataSaving} label={dataSaving ? t("settings.saving") : t("settings.saveDataSourceSettings")} />
          </div>
          <div className="rounded-md border bg-muted/20 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="text-sm font-medium">{t("settings.baostock")}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs ${dataSettings.baostock_supported ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                {dataSettings.baostock_supported ? t("settings.loaderAvailable") : t("settings.noProjectLoader")}
              </span>
            </div>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>{dataSettings.baostock_message}</p>
              <p>{dataSettings.baostock_installed ? t("settings.pythonPackageInstalled") : t("settings.pythonPackageNotInstalled")}</p>
            </div>
          </div>
        </div>
      </form>
    );
  };

  const renderAgentPolicy = () => (
    <div className="space-y-5">
      <section className={sectionCardClass}>
        <div className="mb-5 flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold">{t("settings.agentPolicy.title")}</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <MetricCard label={t("settings.agentPolicy.responseStyle")} value={t("settings.agentPolicy.professional")} />
          <MetricCard label={t("settings.agentPolicy.emojiPolicy")} value={t("settings.agentPolicy.forbidden")} />
          <MetricCard label={t("settings.agentPolicy.citationPolicy")} value={t("settings.agentPolicy.requiredWhenUsingRag")} />
          <MetricCard label={t("settings.agentPolicy.outputLanguage")} value={t("settings.agentPolicy.matchUser")} />
        </div>
        <p className="mt-4 text-sm text-muted-foreground">{t("settings.agentPolicy.description")}</p>
      </section>

      <section className={sectionCardClass}>
        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <h2 className="text-base font-semibold">{t("settings.agentPolicy.toolGovernance")}</h2>
            </div>
            <p className="max-w-3xl text-sm text-muted-foreground">{t("settings.agentPolicy.toolGovernanceDesc")}</p>
          </div>
          <button type="button" onClick={() => loadToolPolicies().catch((error) => toast.error(t("settings.agentPolicy.toolPolicyLoadFailed", { message: error instanceof Error ? error.message : t("settings.unknownError") })))} className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground">
            <RefreshCw className="h-4 w-4" />
            {t("settings.refresh")}
          </button>
        </div>
        {toolPolicies.length ? (
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">{t("settings.agentPolicy.tool")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("settings.agentPolicy.riskLevel")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("settings.agentPolicy.permissionScope")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("settings.agentPolicy.requiresApproval")}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("settings.swarmAgents.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {toolPolicies.slice(0, 24).map((policy) => (
                  <tr key={policy.tool_name} className="border-t">
                    <td className="max-w-xs px-3 py-2 align-top">
                      <div className="font-medium">{policy.tool_name}</div>
                      <div className="line-clamp-2 text-xs text-muted-foreground">{policy.description}</div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <span className={cn("rounded-md border px-2 py-1 text-xs", policy.risk_level === "high" || policy.risk_level === "critical" ? "border-destructive/30 text-destructive" : "border-border text-muted-foreground")}>
                        {t(`settings.agentPolicy.risk.${policy.risk_level}`)}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-top font-mono text-xs text-muted-foreground">{policy.permission_scope}</td>
                    <td className="px-3 py-2 align-top text-muted-foreground">{policy.requires_approval ? t("settings.yes") : t("settings.no")}</td>
                    <td className="px-3 py-2 text-right align-top">
                      <div className="flex justify-end gap-2">
                        <button type="button" disabled={toolPolicySaving === policy.tool_name} onClick={() => updateToolPolicy(policy, { enabled: !policy.enabled })} className="rounded-md border px-2 py-1 text-xs transition hover:bg-muted disabled:opacity-60">
                          {policy.enabled ? t("settings.agentPolicy.disable") : t("settings.agentPolicy.enable")}
                        </button>
                        <button type="button" disabled={toolPolicySaving === policy.tool_name} onClick={() => updateToolPolicy(policy, { requires_approval: !policy.requires_approval })} className="rounded-md border px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted disabled:opacity-60">
                          {policy.requires_approval ? t("settings.agentPolicy.removeApproval") : t("settings.agentPolicy.requireApproval")}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-md border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
            {principal ? t("settings.agentPolicy.noToolPolicies") : t("settings.agentPolicy.signInForToolPolicies")}
          </div>
        )}
      </section>

      <section className={sectionCardClass}>
        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary" />
              <h2 className="text-base font-semibold">{t("settings.swarmAgents.title")}</h2>
            </div>
            <p className="max-w-3xl text-sm text-muted-foreground">{t("settings.swarmAgents.description")}</p>
          </div>
          <button
            type="button"
            onClick={() => loadSwarmPresets().catch((error) => toast.error(t("settings.swarmAgents.loadFailed", { message: error instanceof Error ? error.message : t("settings.unknownError") })))}
            className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            <RefreshCw className="h-4 w-4" />
            {t("settings.refresh")}
          </button>
        </div>

        <div className="mb-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <label className="grid gap-2">
            <span className={labelClass}>{t("settings.swarmAgents.preset")}</span>
            <select
              value={selectedSwarmPreset}
              onChange={(event) => loadSwarmAgents(event.target.value).catch((error) => toast.error(t("settings.swarmAgents.loadFailed", { message: error instanceof Error ? error.message : t("settings.unknownError") })))}
              className={fieldClass}
            >
              {swarmPresets.map((preset) => (
                <option key={preset.name} value={preset.name}>{swarmPresetDisplayName(t, preset)}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={resetSwarmAgentForm}
            className="inline-flex items-center justify-center gap-2 self-end rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            {t("settings.swarmAgents.newAgent")}
          </button>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.1fr)]">
          <div className="overflow-hidden rounded-md border">
            <div className="border-b bg-muted/20 px-3 py-2 text-sm font-semibold">
              {swarmAgentList
                ? swarmPresetDisplayName(t, { name: swarmAgentList.preset_name, title: swarmAgentList.title, description: swarmAgentList.description, agent_count: swarmAgentList.agents.length, variables: [] })
                : selectedSwarmPreset}
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
                {swarmAgentList?.agents.length ? swarmAgentList.agents.map((agent) => (
                  <tr key={agent.id} className={cn("border-t", editingSwarmAgentId === agent.id && "bg-primary/5")}>
                    <td className="px-3 py-2 align-top">
                      <div className="font-medium">{swarmAgentRoleDisplayName(t, selectedSwarmPreset, agent)}</div>
                      <div className="text-xs text-muted-foreground">{agent.id} · {t("settings.swarmAgents.taskCount", { count: agent.task_count ?? 0 })}</div>
                    </td>
                    <td className="max-w-[220px] truncate px-3 py-2 align-top text-xs text-muted-foreground" title={swarmAgentModelLabel(agent)}>
                      {swarmAgentModelLabel(agent)}
                    </td>
                    <td className="px-3 py-2 text-right align-top">
                      <div className="inline-flex items-center gap-1">
                        <button type="button" onClick={() => editSwarmAgent(agent)} className="rounded-md border px-2 py-1 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => deleteSwarmAgent(agent)} disabled={deletingSwarmAgentId === agent.id} className="rounded-md border px-2 py-1 text-xs text-muted-foreground transition hover:border-destructive/40 hover:text-destructive disabled:opacity-50">
                          {deletingSwarmAgentId === agent.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
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

          <form onSubmit={submitSwarmAgent} className="rounded-md border bg-muted/10 p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">{editingSwarmAgentId ? t("settings.swarmAgents.editAgent") : t("settings.swarmAgents.createAgent")}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{t("settings.swarmAgents.formHint")}</p>
              </div>
              {editingSwarmAgentId ? (
                <button type="button" onClick={resetSwarmAgentForm} className="rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground">
                  {t("settings.cancel")}
                </button>
              ) : null}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <TextField label={t("settings.swarmAgents.id")} value={swarmAgentForm.id} onChange={(value) => setSwarmAgentForm((prev) => ({ ...prev, id: value }))} />
              <TextField label={t("settings.swarmAgents.role")} value={swarmAgentForm.role} onChange={(value) => setSwarmAgentForm((prev) => ({ ...prev, role: value }))} />
              <label className="grid gap-2 md:col-span-2">
                <span className={labelClass}>{t("settings.swarmAgents.model")}</span>
                <select value={selectedSwarmModelValue} onChange={(event) => setSwarmAgentModel(event.target.value)} className={fieldClass}>
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
              <NumberField label={t("settings.swarmAgents.maxIterations")} value={swarmAgentForm.max_iterations} min={1} max={200} step={1} onChange={(value) => setSwarmAgentForm((prev) => ({ ...prev, max_iterations: value }))} />
              <NumberField label={t("settings.swarmAgents.timeoutSeconds")} value={swarmAgentForm.timeout_seconds} min={10} max={7200} step={10} onChange={(value) => setSwarmAgentForm((prev) => ({ ...prev, timeout_seconds: value }))} />
              <NumberField label={t("settings.swarmAgents.maxRetries")} value={swarmAgentForm.max_retries} min={0} max={10} step={1} onChange={(value) => setSwarmAgentForm((prev) => ({ ...prev, max_retries: value }))} />
              <label className="grid gap-2">
                <span className={labelClass}>{t("settings.swarmAgents.tools")}</span>
                <textarea value={swarmAgentForm.tools} onChange={(event) => setSwarmAgentForm((prev) => ({ ...prev, tools: event.target.value }))} className={`${fieldClass} min-h-24`} />
              </label>
              <label className="grid gap-2">
                <span className={labelClass}>{t("settings.swarmAgents.skills")}</span>
                <textarea value={swarmAgentForm.skills} onChange={(event) => setSwarmAgentForm((prev) => ({ ...prev, skills: event.target.value }))} className={`${fieldClass} min-h-24`} />
              </label>
              <label className="grid gap-2 md:col-span-2">
                <span className={labelClass}>{t("settings.swarmAgents.systemPrompt")}</span>
                <textarea value={swarmAgentForm.system_prompt} onChange={(event) => setSwarmAgentForm((prev) => ({ ...prev, system_prompt: event.target.value }))} className={`${fieldClass} min-h-52 font-mono text-xs`} />
              </label>
            </div>
            <PrimaryButton type="submit" disabled={swarmAgentSaving} loading={swarmAgentSaving} label={editingSwarmAgentId ? t("settings.swarmAgents.update") : t("settings.swarmAgents.create")} className="mt-4" />
          </form>
        </div>
      </section>
    </div>
  );

  const renderSecurity = () => (
    <div className="space-y-5">
      <form onSubmit={submitLocalApiKey} className={sectionCardClass}>
        <div className="mb-4 space-y-1">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">{t("settings.localApiAccess")}</h2>
          </div>
          <p className="text-sm text-muted-foreground">{t("settings.localApiAccessDesc")}</p>
        </div>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <TextField label={t("settings.serverApiKey")} value={localApiKey} onChange={setLocalApiKeyState} placeholder={t("settings.storedInBrowser")} type="password" />
          <PrimaryButton type="submit" label={t("settings.save")} className="self-end" />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t("settings.storedInBrowser")}</p>
      </form>

      <section className={sectionCardClass}>
        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <h2 className="text-base font-semibold">{t("settings.security.membersTitle")}</h2>
            </div>
            <p className="max-w-3xl text-sm text-muted-foreground">{t("settings.security.membersDescription")}</p>
          </div>
          {canViewOrganizationMembers(principal?.role) ? (
            <button type="button" onClick={() => loadOrganizationMembers().catch((error) => toast.error(t("settings.security.memberLoadFailed", { message: error instanceof Error ? error.message : t("settings.unknownError") })))} className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground">
              <RefreshCw className="h-4 w-4" />
              {t("settings.refresh")}
            </button>
          ) : null}
        </div>

        {!principal ? (
          unavailable(t("settings.security.signInRequired"))
        ) : !canViewOrganizationMembers(principal.role) ? (
          unavailable(t("settings.security.memberPermissionRequired"))
        ) : (
          <div className="space-y-5">
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">{t("settings.security.member")}</th>
                    <th className="px-3 py-2 text-left font-medium">{t("settings.security.role")}</th>
                    <th className="px-3 py-2 text-left font-medium">{t("settings.security.joinedAt")}</th>
                    {canManageOrganizationMembers ? <th className="px-3 py-2 text-right font-medium">{t("settings.security.actions")}</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {organizationMembers.length ? organizationMembers.map((member) => (
                    <tr key={member.user_id} className="border-t transition hover:bg-muted/20">
                      <td className="px-3 py-2 align-top">
                        <div className="font-medium">{member.display_name || member.email}</div>
                        <div className="text-xs text-muted-foreground">{member.email}</div>
                      </td>
                      <td className="px-3 py-2 align-top">
                        {canManageOrganizationMembers ? (
                          <select
                            value={member.role}
                            onChange={(event) => updateOrganizationMemberRole(member, event.target.value as CommercialRole)}
                            disabled={memberActionId === `role:${member.user_id}`}
                            className="rounded-md border border-border/75 bg-background px-2 py-1.5 text-xs outline-none transition focus:border-primary/70 focus:ring-2 focus:ring-primary/20 disabled:opacity-60"
                            aria-label={t("settings.security.memberRoleFor", { email: member.email })}
                          >
                            {(["owner", "admin", "member", "viewer"] as CommercialRole[]).map((role) => (
                              <option key={role} value={role}>{t(`settings.security.roles.${role}`)}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="status-soft">{t(`settings.security.roles.${member.role}`)}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 align-top text-xs text-muted-foreground">
                        {member.created_at.slice(0, 10)}
                      </td>
                      {canManageOrganizationMembers ? (
                        <td className="px-3 py-2 text-right align-top">
                          {member.user_id === principal.user_id ? (
                            <span className="text-xs text-muted-foreground">{t("settings.security.currentUser")}</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => deleteOrganizationMember(member)}
                              disabled={memberActionId === `delete:${member.user_id}`}
                              className="inline-flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-destructive/40 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {memberActionId === `delete:${member.user_id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                              {t("settings.security.removeMember")}
                            </button>
                          )}
                        </td>
                      ) : null}
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={canManageOrganizationMembers ? 4 : 3} className="px-3 py-8 text-center text-sm text-muted-foreground">
                        {t("settings.security.noMembers")}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {canManageOrganizationMembers ? (
              <form onSubmit={submitOrganizationMember} className="rounded-md border bg-muted/10 p-4">
                <div className="mb-4 flex items-center gap-2">
                  <Plus className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold">{t("settings.security.addMemberTitle")}</h3>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <TextField label={t("settings.security.email")} value={memberForm.email} onChange={(value) => setMemberForm((prev) => ({ ...prev, email: value }))} />
                  <TextField label={t("settings.security.displayName")} value={memberForm.display_name} onChange={(value) => setMemberForm((prev) => ({ ...prev, display_name: value }))} />
                  <TextField label={t("settings.security.password")} value={memberForm.password} onChange={(value) => setMemberForm((prev) => ({ ...prev, password: value }))} type="password" />
                  <label className="grid gap-2">
                    <span className={labelClass}>{t("settings.security.role")}</span>
                    <select value={memberForm.role} onChange={(event) => setMemberForm((prev) => ({ ...prev, role: event.target.value as CommercialRole }))} className={fieldClass}>
                      {(["admin", "member", "viewer", "owner"] as CommercialRole[]).map((role) => (
                        <option key={role} value={role}>{t(`settings.security.roles.${role}`)}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <PrimaryButton type="submit" disabled={memberSaving} loading={memberSaving} label={t("settings.security.addMember")} className="mt-4" />
              </form>
            ) : (
              <div className="rounded-md border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                {t("settings.security.adminReadOnly")}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );

  const renderChannels = () => (
    <section className={sectionCardClass}>
      <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <MessageSquareMore className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">{t("settings.channels.title")}</h2>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">{t("settings.channels.description")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={refreshChannelStatus} disabled={channelBusy} className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60">
            {channelRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {t("settings.channels.refresh")}
          </button>
          <button type="button" onClick={() => setChannelsRunning("start")} disabled={channelBusy || !channelStatus} className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60">
            {channelAction === "start" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {t("settings.channels.start")}
          </button>
          <button type="button" onClick={() => setChannelsRunning("stop")} disabled={channelBusy || !channelStatus} className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60">
            {channelAction === "stop" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
            {t("settings.channels.stop")}
          </button>
        </div>
      </div>

      {channelStatus ? (
        <>
          <div className="mb-4 grid gap-3 md:grid-cols-4">
            <MetricCard label={t("settings.channels.runtime")} value={channelStatus.running ? t("settings.channels.running") : t("settings.channels.stopped")} />
            <MetricCard label={t("settings.channels.enabled")} value={String(channelEnabledCount)} />
            <MetricCard label={t("settings.channels.loaded")} value={String(channelLoadedCount)} />
            <MetricCard label={t("settings.channels.unavailable")} value={String(channelUnavailableCount)} />
          </div>
          <div className="mb-4 rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">
            <div className="font-medium text-foreground">{t("settings.channels.howToUseTitle")}</div>
            <p className="mt-1">{t("settings.channels.howToUseBody")}</p>
            <div className="mt-2 font-mono text-xs">/pairing approve &lt;code&gt; · /pairing list · /new</div>
          </div>
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">{t("settings.channels.channel")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("settings.channels.state")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("settings.channels.config")}</th>
                  <th className="px-3 py-2 text-left font-medium">{t("settings.channels.recovery")}</th>
                </tr>
              </thead>
              <tbody>
                {channelRows.map(([name, item]) => (
                  <tr key={name} className="border-t">
                    <td className="px-3 py-2 align-top">
                      <div className="font-medium">{item.display_name || name}</div>
                      <div className="text-xs text-muted-foreground">{name}</div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="flex flex-wrap gap-1.5">
                        <StatusPill active={item.enabled} on={t("settings.channels.enabled")} off={t("settings.channels.disabled")} />
                        <StatusPill active={item.loaded} on={t("settings.channels.loaded")} off={t("settings.channels.notLoaded")} />
                        <StatusPill active={item.running} on={t("settings.channels.running")} off={t("settings.channels.stopped")} />
                      </div>
                    </td>
                    <td className="max-w-xs px-3 py-2 align-top font-mono text-xs text-muted-foreground">
                      {channelConfigHint(name)}
                    </td>
                    <td className="max-w-md px-3 py-2 align-top text-xs text-muted-foreground">
                      {item.install_hint || item.error || t("settings.channels.noRecovery")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : unavailable(loadErrors.channels || t("settings.channels.refreshFailed"))}
    </section>
  );

  const renderRuntime = () => (
    <section className={sectionCardClass}>
      <div className="mb-5 flex items-center gap-2">
        <Activity className="h-4 w-4 text-primary" />
        <h2 className="text-base font-semibold">{t("settings.jobs.title")}</h2>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard label={t("settings.jobs.agentRuns")} value={t("settings.jobs.currentMode")} />
        <MetricCard label={t("settings.jobs.ragIngestion")} value={t("settings.jobs.planned")} />
        <MetricCard label={t("settings.jobs.worker")} value={t("settings.jobs.dockerReady")} />
      </div>
      <p className="mt-4 text-sm text-muted-foreground">{t("settings.jobs.description")}</p>
    </section>
  );

  const renderAudit = () => (
    <section className={sectionCardClass}>
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">{t("settings.audit.title")}</h2>
          </div>
          <p className="text-sm text-muted-foreground">{t("settings.audit.description")}</p>
        </div>
        <button type="button" onClick={() => loadAuditAndUsage().catch((error) => toast.error(t("settings.audit.refreshFailed", { message: error instanceof Error ? error.message : t("settings.unknownError") })))} className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground">
          <RefreshCw className="h-4 w-4" />
          {t("settings.refresh")}
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <MetricCard label={t("settings.audit.modelCalls")} value={String(modelUsage.length)} />
        <MetricCard label={t("settings.audit.totalTokens")} value={String(totalTokens)} />
        <MetricCard label={t("settings.audit.estimatedCost")} value={totalCost.toFixed(4)} />
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="rounded-md border bg-muted/10 p-4">
          <h3 className="mb-3 text-sm font-semibold">{t("settings.audit.tokenTrend")}</h3>
          {usageBars.length ? (
            <div className="space-y-2">
              {usageBars.map(([date, value]) => (
                <div key={date} className="grid grid-cols-[88px_minmax(0,1fr)_72px] items-center gap-2 text-xs">
                  <span className="text-muted-foreground">{date}</span>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, (value / maxUsageBar) * 100)}%` }} />
                  </div>
                  <span className="text-right text-muted-foreground">{value}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-md border bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground">{t("settings.audit.noUsage")}</div>
          )}
        </div>
        <div className="overflow-hidden rounded-md border">
          <div className="border-b bg-muted/20 px-3 py-2 text-sm font-semibold">{t("settings.audit.modelUsage")}</div>
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">{t("settings.audit.time")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("settings.model")}</th>
                <th className="px-3 py-2 text-right font-medium">{t("settings.audit.totalTokens")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("settings.audit.run")}</th>
              </tr>
            </thead>
            <tbody>
              {modelUsage.length ? modelUsage.slice(0, 8).map((usage) => (
                <tr key={usage.id} className="border-t">
                  <td className="whitespace-nowrap px-3 py-2 align-top text-xs text-muted-foreground">{usage.created_at.slice(0, 19).replace("T", " ")}</td>
                  <td className="px-3 py-2 align-top">
                    <div className="font-medium">{usage.provider}</div>
                    <div className="text-xs text-muted-foreground">{usage.model}</div>
                  </td>
                  <td className="px-3 py-2 text-right align-top tabular-nums">{usage.total_tokens}</td>
                  <td className="max-w-[160px] truncate px-3 py-2 align-top text-xs text-muted-foreground" title={usage.run_id || ""}>{usage.run_id || "-"}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-sm text-muted-foreground">{t("settings.audit.noUsage")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="overflow-hidden rounded-md border lg:col-span-2">
          <div className="border-b bg-muted/20 px-3 py-2 text-sm font-semibold">{t("settings.audit.auditLogs")}</div>
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">{t("settings.audit.time")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("settings.audit.action")}</th>
                <th className="px-3 py-2 text-left font-medium">{t("settings.audit.target")}</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.length ? auditLogs.slice(0, 12).map((log) => (
                <tr key={log.id} className="border-t">
                  <td className="whitespace-nowrap px-3 py-2 align-top text-xs text-muted-foreground">{log.created_at.slice(0, 19).replace("T", " ")}</td>
                  <td className="px-3 py-2 align-top font-medium">{log.action}</td>
                  <td className="max-w-sm truncate px-3 py-2 align-top text-xs text-muted-foreground" title={`${log.target_type}:${log.target_id}`}>{log.target_type || "-"} {log.target_id}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={3} className="px-3 py-8 text-center text-sm text-muted-foreground">{t("settings.audit.noAuditLogs")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
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

function MetricCard({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-2 transition-colors hover:bg-muted/35">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="truncate text-sm font-medium" title={title || value}>{value}</div>
    </div>
  );
}

function KnowledgeDocumentTable({
  rows,
  titleLabel,
  chunksLabel,
  sourceLabel,
  statusLabel,
  actionsLabel,
  reindexLabel,
  loadingLabel,
  actionBusyId,
  onReindex,
}: {
  rows: Array<{ id: string; title: string; chunkCount: number; source: string; status: string; ingestionStatus?: string; ingestionProgress?: number; ingestionError?: string }>;
  titleLabel: string;
  chunksLabel: string;
  sourceLabel: string;
  statusLabel: string;
  actionsLabel?: string;
  reindexLabel?: string;
  loadingLabel?: string;
  actionBusyId?: string | null;
  onReindex?: (documentId: string) => void;
}) {
  return (
    <div className="mt-5 overflow-hidden rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left font-medium">{titleLabel}</th>
            <th className="px-3 py-2 text-left font-medium">{chunksLabel}</th>
            <th className="px-3 py-2 text-left font-medium">{statusLabel}</th>
            <th className="px-3 py-2 text-left font-medium">{sourceLabel}</th>
            {onReindex ? <th className="px-3 py-2 text-right font-medium">{actionsLabel}</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((doc) => (
            <tr key={doc.id} className="border-t">
              <td className="px-3 py-2 align-top font-medium">{doc.title}</td>
              <td className="px-3 py-2 align-top text-muted-foreground">{doc.chunkCount}</td>
              <td className="px-3 py-2 align-top text-muted-foreground">
                <div>{doc.ingestionStatus || doc.status}</div>
                {doc.ingestionStatus ? (
                  <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                    <div className="h-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, Number(doc.ingestionProgress || 0)))}%` }} />
                  </div>
                ) : null}
                {doc.ingestionError ? <div className="mt-1 max-w-48 truncate text-xs text-destructive" title={doc.ingestionError}>{doc.ingestionError}</div> : null}
              </td>
              <td className="max-w-md truncate px-3 py-2 align-top text-xs text-muted-foreground" title={doc.source}>{doc.source}</td>
              {onReindex ? (
                <td className="px-3 py-2 text-right align-top">
                  <button
                    type="button"
                    onClick={() => onReindex(doc.id)}
                    disabled={actionBusyId === `reindex:${doc.id}`}
                    className="rounded-md border px-2 py-1 text-xs transition hover:bg-muted disabled:opacity-60"
                  >
                    {actionBusyId === `reindex:${doc.id}` ? loadingLabel : reindexLabel}
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SearchResults({
  results,
  emptyLabel,
}: {
  results: Array<CommercialKnowledgeSearchResult | KnowledgeSearchResult>;
  emptyLabel: string;
}) {
  if (!results.length) {
    return <div className="mt-4 rounded-md border bg-muted/20 px-3 py-4 text-center text-sm text-muted-foreground">{emptyLabel}</div>;
  }
  return (
    <div className="mt-4 space-y-3">
      {results.map((item) => (
        <div key={item.chunk_id} className="rounded-md border bg-background p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium">{item.title}</div>
            <div className="text-xs text-muted-foreground">{Number(item.score).toFixed(4)}</div>
          </div>
          <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{item.text}</p>
          <div className="mt-2 truncate text-xs text-primary" title={item.citation}>{item.citation}</div>
        </div>
      ))}
    </div>
  );
}

function StatusPill({ active, on, off }: { active: boolean; on: string; off: string }) {
  return (
    <span className={active ? "status-primary" : "status-soft"}>
      {active ? on : off}
    </span>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="grid gap-2">
      <span className={labelClass}>{label}</span>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} className={fieldClass} placeholder={placeholder} autoComplete={type === "password" ? "current-password" : undefined} />
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
      <input type="number" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} className={fieldClass} />
    </label>
  );
}

function PrimaryButton({
  type = "button",
  disabled,
  loading,
  label,
  className,
}: {
  type?: "button" | "submit";
  disabled?: boolean;
  loading?: boolean;
  label: string;
  className?: string;
}) {
  return (
    <button type={type} disabled={disabled} className={cn("inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70", className)}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
      {label}
    </button>
  );
}

function EnvPath({ value }: { value: string }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{t("settings.saved")}: </span>
      <span className="break-all font-mono">{value}</span>
    </div>
  );
}
