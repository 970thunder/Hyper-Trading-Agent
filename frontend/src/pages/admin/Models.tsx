import { useEffect, useState, type FormEvent } from "react";
import { Cpu } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  api,
  type CommercialModelProvider,
  type CommercialModelProviderCreateRequest,
  type CommercialModelProviderUpdateRequest,
  type LLMProviderOption,
  type LLMSettings,
} from "@/lib/api";
import { InlineError, Skeleton } from "@/components/ui/AsyncState";
import {
  CommercialModelProvidersPanel,
  type ModelProviderFormState,
} from "@/pages/settings/CommercialModelProvidersPanel";

export function Models() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<LLMSettings | null>(null);
  const [providers, setProviders] = useState<CommercialModelProvider[]>([]);
  const [form, setForm] = useState<ModelProviderFormState>(() => toForm(null));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const load = async () => {
    setError("");
    const [nextSettings, nextProviders] = await Promise.all([
      api.getLLMSettings(),
      api.listCommercialModelProviders(),
    ]);
    setSettings(nextSettings);
    setProviders(nextProviders);
    if (!editingId) setForm(toForm(nextSettings));
  };

  useEffect(() => {
    let alive = true;
    load()
      .catch((loadError) => { if (alive) setError(errorMessage(loadError)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const reset = () => {
    setEditingId(null);
    setForm(toForm(settings));
  };

  const edit = (provider: CommercialModelProvider) => {
    setEditingId(provider.id);
    setForm({
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

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    const payload: CommercialModelProviderCreateRequest | CommercialModelProviderUpdateRequest = {
      provider: form.provider,
      model: form.model.trim(),
      base_url: form.base_url.trim(),
      api_key: form.api_key.trim() || undefined,
      clear_api_key: form.clear_api_key,
      temperature: form.temperature,
      timeout_seconds: form.timeout_seconds,
      max_retries: form.max_retries,
      enabled: form.enabled,
      is_default: form.is_default,
    };
    try {
      if (editingId) await api.updateCommercialModelProvider(editingId, payload);
      else await api.createCommercialModelProvider(payload as CommercialModelProviderCreateRequest);
      setFormOpen(false);
      reset();
      await load();
      toast.success(editingId ? t("settings.modelProviderActions.updated") : t("settings.modelProviderActions.created"));
    } catch (submitError) {
      toast.error(errorMessage(submitError));
    } finally {
      setSaving(false);
    }
  };

  const testProvider = async (id: string) => {
    setTestingId(id);
    try {
      const result = await api.testCommercialModelProvider(id);
      if (!result.reachable) toast.error(result.error || t("settings.modelProviderActions.testFailed"));
      return result;
    } catch (testError) {
      toast.error(errorMessage(testError));
      throw testError;
    } finally {
      setTestingId(null);
    }
  };

  const mutate = async (operation: () => Promise<unknown>, success?: string) => {
    try {
      await operation();
      await load();
      if (success) toast.success(success);
    } catch (mutationError) {
      toast.error(errorMessage(mutationError));
    }
  };

  const options = settings?.providers || [];

  if (loading) return <div className="grid gap-4"><Skeleton className="h-20" /><Skeleton className="h-[520px]" /></div>;
  if (error) return <InlineError title={t("adminCenter.models.loadFailed")} message={error} retryLabel={t("adminCenter.retry")} onRetry={() => void load()} />;

  return (
    <div data-page-enter className="grid gap-4">
      <header>
        <div className="flex items-center gap-2"><Cpu className="h-5 w-5 text-primary" /><h2 className="text-xl font-semibold text-ink-strong">{t("adminCenter.models.title")}</h2></div>
        <p className="mt-1 max-w-3xl text-sm leading-5 text-ink-muted">{t("adminCenter.models.description")}</p>
      </header>
      <CommercialModelProvidersPanel
        providers={providers}
        providerOptions={options}
        form={form}
        editingProviderId={editingId}
        saving={saving}
        testingProviderId={testingId}
        formOpen={formOpen}
        onFormOpenChange={setFormOpen}
        onRefresh={load}
        onEditProvider={edit}
        onTestProvider={testProvider}
        onToggleProvider={(provider) => mutate(() => api.updateCommercialModelProvider(provider.id, { enabled: !Boolean(provider.enabled) }))}
        onSetDefaultProvider={(id) => mutate(() => api.setDefaultCommercialModelProvider(id), t("settings.modelProviderActions.defaultUpdated"))}
        onDeleteProvider={(provider) => mutate(() => api.deleteCommercialModelProvider(provider.id), t("settings.modelProviderActions.deleted"))}
        onResetForm={reset}
        onFormChange={(patch) => setForm((current) => ({ ...current, ...patch }))}
        onProviderChange={(name) => {
          const option = options.find((item) => item.name === name);
          setForm((current) => ({
            ...current,
            provider: name,
            model: option?.default_model || current.model,
            base_url: option?.default_base_url || current.base_url,
          }));
        }}
        onSubmit={submit}
      />
    </div>
  );
}

function toForm(settings: LLMSettings | null, option?: LLMProviderOption): ModelProviderFormState {
  const selected = option || settings?.providers?.[0];
  return {
    provider: selected?.name || settings?.provider || "siliconflow",
    model: selected?.default_model || settings?.model_name || "deepseek-ai/DeepSeek-V3.2",
    base_url: selected?.default_base_url || settings?.base_url || "https://api.siliconflow.cn/v1",
    api_key: "",
    clear_api_key: false,
    temperature: settings?.temperature || 0,
    timeout_seconds: settings?.timeout_seconds || 120,
    max_retries: settings?.max_retries || 2,
    enabled: true,
    is_default: false,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}
