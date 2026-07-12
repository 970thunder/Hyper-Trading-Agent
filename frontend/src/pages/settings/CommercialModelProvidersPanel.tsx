import type { FormEvent } from "react";
import { Loader2, RefreshCw, RotateCcw, Save, Server, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { CommercialModelProvider, LLMProviderOption } from "@/lib/api";

const fieldClass =
  "w-full rounded-md border border-border/75 bg-background px-3 py-2 text-sm outline-none transition focus:border-primary/70 focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60";
const labelClass = "text-sm font-medium";
const hintClass = "text-xs text-muted-foreground";
const sectionCardClass = "rounded-lg border border-border/70 bg-card p-5 shadow-sm";

export interface ModelProviderFormState {
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

interface CommercialModelProvidersPanelProps {
  providers: CommercialModelProvider[];
  providerOptions: LLMProviderOption[];
  form: ModelProviderFormState;
  editingProviderId: string | null;
  saving: boolean;
  testingProviderId: string | null;
  onRefresh: () => Promise<void> | void;
  onEditProvider: (provider: CommercialModelProvider) => void;
  onTestProvider: (id: string) => Promise<void> | void;
  onToggleProvider: (provider: CommercialModelProvider) => Promise<void> | void;
  onSetDefaultProvider: (id: string) => Promise<void> | void;
  onDeleteProvider: (provider: CommercialModelProvider) => Promise<void> | void;
  onResetForm: () => void;
  onFormChange: (patch: Partial<ModelProviderFormState>) => void;
  onProviderChange: (name: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function CommercialModelProvidersPanel({
  providers,
  providerOptions,
  form,
  editingProviderId,
  saving,
  testingProviderId,
  onRefresh,
  onEditProvider,
  onTestProvider,
  onToggleProvider,
  onSetDefaultProvider,
  onDeleteProvider,
  onResetForm,
  onFormChange,
  onProviderChange,
  onSubmit,
}: CommercialModelProvidersPanelProps) {
  const { t } = useTranslation();
  const selectedProvider = providerOptions.find((item) => item.name === form.provider);

  const handleRefresh = () => {
    Promise.resolve(onRefresh()).catch((error) => {
      toast.error(error instanceof Error ? error.message : t("settings.unknownError"));
    });
  };

  const useProviderDefaults = () => {
    onFormChange({
      model: selectedProvider?.default_model ?? form.model,
      base_url: selectedProvider?.default_base_url ?? form.base_url,
    });
  };

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
          <button type="button" onClick={handleRefresh} className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground">
            <RefreshCw className="h-4 w-4" />
            {t("settings.refresh")}
          </button>
        </div>

        {providers.length === 0 ? (
          <div className="rounded-lg border bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
            {t("settings.modelProviders.empty")}
          </div>
        ) : (
          <div className="grid gap-3">
            {providers.map((provider) => (
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
                    <button type="button" aria-label={`Edit ${provider.id}`} onClick={() => onEditProvider(provider)} className="rounded-md border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground">
                      {t("settings.modelProviderActions.edit")}
                    </button>
                    <button type="button" aria-label={`Test ${provider.id}`} onClick={() => onTestProvider(provider.id)} disabled={testingProviderId === provider.id} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50">
                      {testingProviderId === provider.id ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                      {t("settings.modelProviderActions.test")}
                    </button>
                    <button type="button" onClick={() => onToggleProvider(provider)} disabled={Boolean(provider.is_default) && Boolean(provider.enabled)} className="rounded-md border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50">
                      {Boolean(provider.enabled) ? t("settings.modelProviderActions.disable") : t("settings.modelProviderActions.enable")}
                    </button>
                    <button type="button" onClick={() => onSetDefaultProvider(provider.id)} disabled={Boolean(provider.is_default) || !Boolean(provider.enabled)} className="rounded-md border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50">
                      {t("settings.modelProviderActions.setDefault")}
                    </button>
                    <button type="button" onClick={() => onDeleteProvider(provider)} disabled={Boolean(provider.is_default)} className="rounded-md border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-destructive/40 hover:text-destructive disabled:opacity-50">
                      {t("settings.modelProviderActions.delete")}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <form onSubmit={onSubmit} className={sectionCardClass}>
        <div className="mb-5 flex items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-primary" />
              <h2 className="text-base font-semibold">
                {editingProviderId ? t("settings.modelProviderForm.editTitle") : t("settings.modelProviderForm.createTitle")}
              </h2>
            </div>
            <p className="text-sm text-muted-foreground">{t("settings.modelProviderForm.description")}</p>
          </div>
          {editingProviderId ? (
            <button type="button" onClick={onResetForm} className="rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground">
              {t("settings.modelProviderActions.cancelEdit")}
            </button>
          ) : null}
        </div>

        <div className="grid gap-4">
          <label className="grid gap-2">
            <span className={labelClass}>{t("settings.provider")}</span>
            <select value={form.provider} onChange={(event) => onProviderChange(event.target.value)} className={fieldClass}>
              {providerOptions.map((provider) => (
                <option key={provider.name} value={provider.name}>{provider.label}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-2">
            <span className={labelClass}>{t("settings.model")}</span>
            <select value={form.model} onChange={(event) => onFormChange({ model: event.target.value })} className={fieldClass} required>
              {modelOptionsFor(selectedProvider, form.model).map((model) => (
                <option key={model} value={model}>{model}</option>
              ))}
            </select>
            <span className={hintClass}>{t("settings.modelIdHint")}</span>
          </label>
          <label className="grid gap-2">
            <span className={labelClass}>{t("settings.baseUrl")}</span>
            <div className="flex gap-2">
              <input value={form.base_url} onChange={(event) => onFormChange({ base_url: event.target.value })} className={fieldClass} placeholder={selectedProvider?.default_base_url} />
              <button type="button" onClick={useProviderDefaults} className="inline-flex shrink-0 items-center rounded-md border px-3 text-muted-foreground transition hover:bg-muted hover:text-foreground" title={t("settings.useProviderDefaults")}>
                <RotateCcw className="h-4 w-4" />
              </button>
            </div>
          </label>
          <TextField label="API key" value={form.api_key} onChange={(value) => onFormChange({ api_key: value, clear_api_key: false })} type="password" placeholder={editingProviderId ? t("settings.modelProviderForm.keepExistingKey") : ""} />
          {editingProviderId ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={form.clear_api_key} onChange={(event) => onFormChange({ clear_api_key: event.target.checked, api_key: event.target.checked ? "" : form.api_key })} className="h-3.5 w-3.5 accent-primary" />
              {t("settings.clearApiKey")}
            </label>
          ) : null}
          <div className="grid grid-cols-3 gap-3">
            <NumberField label={t("settings.temperature")} value={form.temperature} min={0} max={2} step={0.1} onChange={(value) => onFormChange({ temperature: value })} />
            <NumberField label={t("settings.timeoutSeconds")} value={form.timeout_seconds} min={1} max={3600} step={1} onChange={(value) => onFormChange({ timeout_seconds: value })} />
            <NumberField label={t("settings.maxRetries")} value={form.max_retries} min={0} max={20} step={1} onChange={(value) => onFormChange({ max_retries: value })} />
          </div>
          <div className="grid gap-2 rounded-md border bg-muted/20 p-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.enabled} onChange={(event) => onFormChange({ enabled: event.target.checked })} className="h-4 w-4 accent-primary" />
              {t("settings.modelProviders.enabled")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.is_default} onChange={(event) => onFormChange({ is_default: event.target.checked })} className="h-4 w-4 accent-primary" />
              {t("settings.modelProviderForm.makeDefault")}
            </label>
          </div>
          <button type="submit" disabled={saving || !form.model.trim() || !form.base_url.trim()} className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {editingProviderId ? t("settings.modelProviderActions.update") : t("settings.modelProviderActions.create")}
          </button>
        </div>
      </form>
    </div>
  );
}

function modelOptionsFor(provider?: LLMProviderOption, currentModel?: string) {
  const values = provider?.model_options?.length
    ? provider.model_options
    : provider?.default_model
      ? [provider.default_model]
      : [];
  const merged = currentModel && !values.includes(currentModel) ? [currentModel, ...values] : values;
  return Array.from(new Set(merged.filter(Boolean)));
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
