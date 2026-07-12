import type { FormEvent } from "react";
import { KeyRound, Loader2, RotateCcw, Save, Server, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { LLMProviderOption, LLMSettings } from "@/lib/api";
import { cn } from "@/lib/utils";

export interface LLMFormState {
  provider: string;
  model_name: string;
  base_url: string;
  temperature: number;
  timeout_seconds: number;
  max_retries: number;
  reasoning_effort: string;
}

interface LocalModelSettingsPanelProps {
  settings: LLMSettings;
  form: LLMFormState;
  providers: LLMProviderOption[];
  selectedProvider?: LLMProviderOption;
  apiKey: string;
  clearApiKey: boolean;
  saving: boolean;
  keyStatus: string;
  apiKeyDisabled: boolean;
  onSubmit: (event: FormEvent) => void;
  onProviderChange: (provider: string) => void;
  onApplyProviderDefaults: () => void;
  onFormChange: (patch: Partial<LLMFormState>) => void;
  onApiKeyChange: (value: string) => void;
  onClearApiKeyChange: (value: boolean) => void;
}

const fieldClass =
  "w-full rounded-md border border-border/75 bg-background px-3 py-2 text-sm outline-none transition focus:border-primary/70 focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60";
const labelClass = "text-sm font-medium";
const hintClass = "text-xs text-muted-foreground";
const sectionCardClass = "rounded-lg border border-border/70 bg-card p-5 shadow-sm";

export function LocalModelSettingsPanel({
  settings,
  form,
  providers,
  selectedProvider,
  apiKey,
  clearApiKey,
  saving,
  keyStatus,
  apiKeyDisabled,
  onSubmit,
  onProviderChange,
  onApplyProviderDefaults,
  onFormChange,
  onApiKeyChange,
  onClearApiKeyChange,
}: LocalModelSettingsPanelProps) {
  const { t } = useTranslation();
  return (
    <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.75fr)]">
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
              <select value={form.model_name} onChange={(event) => onFormChange({ model_name: event.target.value })} className={fieldClass} required>
                {modelOptionsFor(selectedProvider, form.model_name).map((model) => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
              <button type="button" onClick={onApplyProviderDefaults} className="inline-flex shrink-0 items-center gap-2 rounded-md border px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground" title={t("settings.useProviderDefaults")}>
                <RotateCcw className="h-4 w-4" />
                <span className="hidden sm:inline">{t("settings.useProviderDefaults")}</span>
              </button>
            </div>
            <span className={hintClass}>{t("settings.modelIdHint")}</span>
          </label>

          <label className="grid gap-2">
            <span className={labelClass}>{t("settings.baseUrl")}</span>
            <input value={form.base_url} onChange={(event) => onFormChange({ base_url: event.target.value })} className={fieldClass} placeholder={selectedProvider?.default_base_url} disabled={selectedProvider?.auth_type === "oauth"} />
          </label>

          <label className="grid gap-2">
            <span className={labelClass}>{selectedProvider?.auth_type === "oauth" ? "OAuth" : t("settings.apiAuthKey")}</span>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <input type="password" value={apiKey} onChange={(event) => onApiKeyChange(event.target.value)} className={`${fieldClass} pl-9`} placeholder={keyStatus} autoComplete="current-password" disabled={apiKeyDisabled} />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className={hintClass}>{keyStatus}</span>
              {selectedProvider?.api_key_required ? (
                <label className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={clearApiKey}
                    onChange={(event) => onClearApiKeyChange(event.target.checked)}
                    className="h-3.5 w-3.5 accent-primary"
                  />
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
          <NumberField label={t("settings.temperature")} value={form.temperature} min={0} max={2} step={0.1} onChange={(value) => onFormChange({ temperature: value })} />
          <NumberField label={t("settings.timeoutSeconds")} value={form.timeout_seconds} min={1} max={3600} step={1} onChange={(value) => onFormChange({ timeout_seconds: value })} />
          <NumberField label={t("settings.maxRetries")} value={form.max_retries} min={0} max={20} step={1} onChange={(value) => onFormChange({ max_retries: value })} />

          <label className="grid gap-2">
            <span className={labelClass}>{t("settings.reasoningEffort")}</span>
            <select value={form.reasoning_effort} onChange={(event) => onFormChange({ reasoning_effort: event.target.value })} className={fieldClass}>
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
