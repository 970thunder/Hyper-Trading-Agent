import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  {
    name: "openai",
    label: "OpenAI",
    default_model: "gpt-5.1",
    default_base_url: "https://api.openai.com/v1",
    model_options: ["gpt-5.1"],
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
  it("renders organization model providers and exposes provider actions", async () => {
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

    const onFormOpenChange = vi.fn();
    const { container } = render(
      <CommercialModelProvidersPanel
        providers={providers}
        providerOptions={providerOptions}
        form={form}
        editingProviderId={null}
        saving={false}
        testingProviderId={null}
        formOpen
        onFormOpenChange={onFormOpenChange}
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
    expect(container.querySelector("select")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Provider: SiliconFlow/i }));
    fireEvent.click(screen.getByRole("option", { name: /^OpenAI/ }));
    expect(onProviderChange).toHaveBeenCalledWith("openai");

    fireEvent.click(screen.getByRole("button", { name: /Model: deepseek-ai\/DeepSeek-V3.2/i }));
    expect(screen.getByRole("option", { name: "Qwen/Qwen3-Coder" })).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole("listbox", { name: "Model" })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Provider: SiliconFlow/i }));
    fireEvent.click(screen.getByRole("option", { name: "Custom provider" }));
    expect(onFormChange).toHaveBeenCalledWith({ provider: "" });

    fireEvent.click(screen.getByRole("button", { name: /Model: deepseek-ai\/DeepSeek-V3.2/i }));
    fireEvent.click(screen.getByRole("option", { name: "Custom model ID" }));
    expect(onFormChange).toHaveBeenCalledWith({ model: "" });

    fireEvent.click(screen.getByRole("button", { name: "Edit provider-1" }));
    expect(onEditProvider).toHaveBeenCalledWith(providers[0]);
    expect(onFormOpenChange).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByRole("button", { name: "Test provider-1" }));
    expect(onTestProvider).toHaveBeenCalledWith("provider-1");
  });
});
