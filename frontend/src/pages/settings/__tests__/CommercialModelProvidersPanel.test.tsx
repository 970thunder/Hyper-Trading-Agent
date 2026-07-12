import { fireEvent, render, screen } from "@testing-library/react";
import type { FormEvent } from "react";
import { CommercialModelProvidersPanel, type ModelProviderFormState } from "../CommercialModelProvidersPanel";
import type { CommercialModelProvider, LLMProviderOption } from "@/lib/api";

const providerOptions: LLMProviderOption[] = [
  {
    name: "siliconflow",
    label: "SiliconFlow",
    default_model: "deepseek-ai/DeepSeek-V3.2",
    default_base_url: "https://api.siliconflow.cn/v1",
    model_options: ["deepseek-ai/DeepSeek-V3.2", "Qwen/Qwen3-Coder"],
  },
];

const providers: CommercialModelProvider[] = [
  {
    id: "provider-1",
    provider: "siliconflow",
    model: "deepseek-ai/DeepSeek-V3.2",
    base_url: "https://api.siliconflow.cn/v1",
    api_key_configured: true,
    temperature: 0.2,
    timeout_seconds: 120,
    max_retries: 2,
    enabled: true,
    is_default: true,
    created_at: "2026-07-12T00:00:00Z",
    updated_at: "2026-07-12T00:00:00Z",
  },
];

const form: ModelProviderFormState = {
  provider: "siliconflow",
  model: "deepseek-ai/DeepSeek-V3.2",
  base_url: "https://api.siliconflow.cn/v1",
  api_key: "",
  clear_api_key: false,
  temperature: 0.2,
  timeout_seconds: 120,
  max_retries: 2,
  enabled: true,
  is_default: false,
};

describe("CommercialModelProvidersPanel", () => {
  it("renders organization model providers and exposes provider actions", () => {
    const onRefresh = vi.fn();
    const onEditProvider = vi.fn();
    const onTestProvider = vi.fn();
    const onToggleProvider = vi.fn();
    const onSetDefaultProvider = vi.fn();
    const onDeleteProvider = vi.fn();
    const onResetForm = vi.fn();
    const onFormChange = vi.fn();
    const onProviderChange = vi.fn();
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());

    render(
      <CommercialModelProvidersPanel
        providers={providers}
        providerOptions={providerOptions}
        form={form}
        editingProviderId={null}
        saving={false}
        testingProviderId={null}
        onRefresh={onRefresh}
        onEditProvider={onEditProvider}
        onTestProvider={onTestProvider}
        onToggleProvider={onToggleProvider}
        onSetDefaultProvider={onSetDefaultProvider}
        onDeleteProvider={onDeleteProvider}
        onResetForm={onResetForm}
        onFormChange={onFormChange}
        onProviderChange={onProviderChange}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByText("Organization model providers")).toBeInTheDocument();
    expect(screen.getAllByText("deepseek-ai/DeepSeek-V3.2").length).toBeGreaterThan(0);
    expect(screen.getByText("Default")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Qwen/Qwen3-Coder" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit provider-1" }));
    expect(onEditProvider).toHaveBeenCalledWith(providers[0]);

    fireEvent.click(screen.getByRole("button", { name: "Test provider-1" }));
    expect(onTestProvider).toHaveBeenCalledWith("provider-1");
  });
});
