import { useId, useState, type FormEvent } from "react";
import { KeyRound, Pencil, Plus, RefreshCw, RotateCcw, Server, Star, Trash2, Wifi } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { CommercialModelProvider, LLMProviderOption } from "@/lib/api";
import { Button, IconButton } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Drawer } from "@/components/ui/Drawer";
import { Field, Input, NumberInput } from "@/components/ui/Field";
import { Panel, SectionHeader } from "@/components/ui/Panel";
import { Select } from "@/components/ui/Select";
import { StatusIndicator } from "@/components/ui/Status";

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
  formOpen: boolean;
  onFormOpenChange: (open: boolean) => void;
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
  formOpen,
  onFormOpenChange,
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
  const formId = `model-provider-${useId().replace(/:/g, "")}`;
  const [deleteTarget, setDeleteTarget] = useState<CommercialModelProvider | null>(null);
  const [deleting, setDeleting] = useState(false);
  const selectedProvider = providerOptions.find((item) => item.name === form.provider);
  const providerSelectOptions = providerOptions.map((provider) => ({
    value: provider.name,
    label: provider.label,
    description: provider.default_base_url,
  }));
  const modelSelectOptions = modelOptionsFor(selectedProvider, form.model).map((model) => ({ value: model, label: model }));

  const refresh = () => {
    Promise.resolve(onRefresh()).catch((error) => {
      toast.error(error instanceof Error ? error.message : t("settings.unknownError"));
    });
  };

  const openCreate = () => {
    onResetForm();
    onFormOpenChange(true);
  };

  const openEdit = (provider: CommercialModelProvider) => {
    onEditProvider(provider);
    onFormOpenChange(true);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await onDeleteProvider(deleteTarget);
      setDeleteTarget(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Panel padding="none" className="overflow-hidden">
        <SectionHeader
          className="border-b border-[hsl(var(--border-subtle))] p-4"
          title={t("settings.modelProviders.title")}
          description={t("settings.modelProviders.description")}
          actions={(
            <>
              <Button variant="ghost" leftIcon={<RefreshCw className="h-4 w-4" />} onClick={refresh}>
                {t("settings.refresh")}
              </Button>
              <Button variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={openCreate}>
                {t("settings.modelProviderActions.create")}
              </Button>
            </>
          )}
        />

        {providers.length === 0 ? (
          <div className="grid min-h-52 place-items-center px-6 py-10 text-center">
            <div>
              <Server className="mx-auto h-7 w-7 text-ink-disabled" />
              <p className="mt-3 text-sm text-ink-muted">{t("settings.modelProviders.empty")}</p>
              <Button className="mt-4" variant="primary" leftIcon={<Plus className="h-4 w-4" />} onClick={openCreate}>
                {t("settings.modelProviderActions.create")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-[hsl(var(--border-subtle))]">
            {providers.map((provider) => (
              <div
                key={provider.id}
                className="grid gap-3 px-4 py-3 transition-[background-color] duration-fast ease-standard hover:bg-surface-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-ink-strong">{provider.model}</span>
                    <StatusIndicator
                      label={provider.enabled ? t("settings.modelProviders.enabled") : t("settings.modelProviders.disabled")}
                      tone={provider.enabled ? "success" : "neutral"}
                      dot
                    />
                    {provider.is_default ? <StatusIndicator label={t("settings.modelProviders.default")} tone="primary" /> : null}
                  </div>
                  <p className="mt-1 truncate text-xs text-ink-muted" title={`${provider.provider} / ${provider.base_url}`}>
                    {provider.provider} / {provider.base_url}
                  </p>
                  <p className="mt-0.5 text-xs tabular-nums text-ink-muted">
                    {t("settings.modelProviders.params", {
                      temperature: provider.temperature,
                      timeout: provider.timeout_seconds,
                      retries: provider.max_retries,
                    })}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
                  <IconButton label={`Edit ${provider.id}`} variant="ghost" onClick={() => openEdit(provider)}>
                    <Pencil className="h-4 w-4" />
                  </IconButton>
                  <Button
                    size="sm"
                    variant="outline"
                    loading={testingProviderId === provider.id}
                    aria-label={`Test ${provider.id}`}
                    leftIcon={<Wifi className="h-3.5 w-3.5" />}
                    onClick={() => onTestProvider(provider.id)}
                  >
                    {t("settings.modelProviderActions.test")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={Boolean(provider.is_default) || !Boolean(provider.enabled)}
                    leftIcon={<Star className="h-3.5 w-3.5" />}
                    onClick={() => onSetDefaultProvider(provider.id)}
                  >
                    {t("settings.modelProviderActions.setDefault")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={Boolean(provider.is_default) && Boolean(provider.enabled)}
                    onClick={() => onToggleProvider(provider)}
                  >
                    {provider.enabled ? t("settings.modelProviderActions.disable") : t("settings.modelProviderActions.enable")}
                  </Button>
                  <IconButton
                    label={`${t("settings.modelProviderActions.delete")} ${provider.model}`}
                    variant="ghost"
                    disabled={Boolean(provider.is_default)}
                    className="text-danger hover:bg-danger/10 hover:text-danger"
                    onClick={() => setDeleteTarget(provider)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Drawer
        open={formOpen}
        onOpenChange={onFormOpenChange}
        title={editingProviderId ? t("settings.modelProviderForm.editTitle") : t("settings.modelProviderForm.createTitle")}
        description={t("settings.modelProviderForm.description")}
        closeLabel={t("settings.modelProviderActions.cancelEdit")}
        className="w-[min(38rem,calc(100vw-0.75rem))]"
        footer={(
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onFormOpenChange(false)}>{t("settings.cancel")}</Button>
            <Button type="submit" form={formId} variant="primary" loading={saving} leftIcon={<KeyRound className="h-4 w-4" />}>
              {editingProviderId ? t("settings.modelProviderActions.update") : t("settings.modelProviderActions.create")}
            </Button>
          </div>
        )}
      >
        <form id={formId} onSubmit={onSubmit} className="grid gap-5 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("settings.provider")}>
              <Select
                value={form.provider}
                onValueChange={onProviderChange}
                options={providerSelectOptions}
                label={t("settings.provider")}
                searchable
                contentClassName="max-h-80"
                className="w-full"
              />
            </Field>
            <Field label={t("settings.model")} hint={t("settings.modelIdHint")}>
              <Select
                value={form.model}
                onValueChange={(model) => onFormChange({ model })}
                options={modelSelectOptions}
                label={t("settings.model")}
                searchable
                className="w-full"
              />
            </Field>
          </div>

          <Field label={t("settings.baseUrl")}>
            <div className="flex gap-2">
              <Input
                value={form.base_url}
                onChange={(event) => onFormChange({ base_url: event.target.value })}
                placeholder={selectedProvider?.default_base_url}
                required
              />
              <IconButton
                label={t("settings.useProviderDefaults")}
                variant="outline"
                onClick={() => onFormChange({
                  model: selectedProvider?.default_model ?? form.model,
                  base_url: selectedProvider?.default_base_url ?? form.base_url,
                })}
              >
                <RotateCcw className="h-4 w-4" />
              </IconButton>
            </div>
          </Field>

          <Field label={t("settings.modelProviderForm.apiKey")} hint={editingProviderId ? t("settings.modelProviderForm.keepExistingKey") : undefined}>
            <Input
              type="password"
              autoComplete="new-password"
              value={form.api_key}
              onChange={(event) => onFormChange({ api_key: event.target.value, clear_api_key: false })}
            />
          </Field>

          {editingProviderId ? (
            <CheckControl
              checked={form.clear_api_key}
              label={t("settings.clearApiKey")}
              onChange={(checked) => onFormChange({ clear_api_key: checked, api_key: checked ? "" : form.api_key })}
            />
          ) : null}

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={t("settings.temperature")}>
              <NumberInput min={0} max={2} step={0.1} value={form.temperature} onChange={(event) => onFormChange({ temperature: Number(event.target.value) })} />
            </Field>
            <Field label={t("settings.timeoutSeconds")}>
              <NumberInput min={1} max={3600} step={1} value={form.timeout_seconds} onChange={(event) => onFormChange({ timeout_seconds: Number(event.target.value) })} />
            </Field>
            <Field label={t("settings.maxRetries")}>
              <NumberInput min={0} max={20} step={1} value={form.max_retries} onChange={(event) => onFormChange({ max_retries: Number(event.target.value) })} />
            </Field>
          </div>

          <div className="grid gap-2 border-t border-[hsl(var(--border-subtle))] pt-4 sm:grid-cols-2">
            <CheckControl checked={form.enabled} label={t("settings.modelProviders.enabled")} onChange={(enabled) => onFormChange({ enabled })} />
            <CheckControl checked={form.is_default} label={t("settings.modelProviderForm.makeDefault")} onChange={(is_default) => onFormChange({ is_default })} />
          </div>
        </form>
      </Drawer>

      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={t("settings.modelProviderForm.deleteTitle")}
        description={t("settings.modelProviderForm.deleteDescription", { model: deleteTarget?.model || "" })}
        closeLabel={t("settings.cancel")}
        className="w-[min(30rem,calc(100vw-2rem))]"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>{t("settings.cancel")}</Button>
            <Button variant="destructive" loading={deleting} leftIcon={<Trash2 className="h-4 w-4" />} onClick={() => void confirmDelete()}>
              {t("settings.modelProviderActions.delete")}
            </Button>
          </>
        )}
      >
        <p className="text-sm leading-6 text-ink">{t("settings.modelProviderForm.deleteWarning")}</p>
      </Dialog>
    </>
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

function CheckControl({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md border border-[hsl(var(--border-subtle))] bg-surface-2 px-3 text-sm text-ink transition-[border-color,background-color] duration-fast hover:border-border">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-primary" />
      <span>{label}</span>
    </label>
  );
}
