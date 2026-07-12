import { fireEvent, render, screen } from "@testing-library/react";
import { DataSourceSettingsPanel } from "../DataSourceSettingsPanel";
import { LocalModelSettingsPanel, type LLMFormState } from "../LocalModelSettingsPanel";
import { SettingsOverviewPanel } from "../SettingsOverviewPanel";
import type { DataSourceSettings, LLMProviderOption, LLMSettings } from "@/lib/api";

const providerOptions: LLMProviderOption[] = [
  {
    name: "siliconflow",
    label: "SiliconFlow",
    api_key_env: "SILICONFLOW_API_KEY",
    base_url_env: "SILICONFLOW_BASE_URL",
    default_model: "deepseek-ai/DeepSeek-V3.2",
    default_base_url: "https://api.siliconflow.cn/v1",
    api_key_required: true,
    auth_type: "api_key",
    model_options: ["deepseek-ai/DeepSeek-V3.2", "Qwen/Qwen3-235B-A22B-Instruct-2507"],
  },
];

const llmSettings: LLMSettings = {
  provider: "siliconflow",
  model_name: "deepseek-ai/DeepSeek-V3.2",
  base_url: "https://api.siliconflow.cn/v1",
  api_key_env: "SILICONFLOW_API_KEY",
  api_key_configured: true,
  api_key_required: true,
  temperature: 0.2,
  timeout_seconds: 120,
  max_retries: 2,
  reasoning_effort: "",
  sse_timeout_seconds: 300,
  env_path: "agent/.env",
  providers: providerOptions,
};

const form: LLMFormState = {
  provider: "siliconflow",
  model_name: "deepseek-ai/DeepSeek-V3.2",
  base_url: "https://api.siliconflow.cn/v1",
  temperature: 0.2,
  timeout_seconds: 120,
  max_retries: 2,
  reasoning_effort: "",
};

const dataSettings: DataSourceSettings = {
  tushare_token_configured: false,
  baostock_supported: true,
  baostock_installed: true,
  baostock_message: "BaoStock available",
  env_path: "agent/.env",
};

describe("Settings light panels", () => {
  it("renders overview metrics without owning settings state", () => {
    render(
      <SettingsOverviewPanel
        modelName="deepseek-ai/DeepSeek-V3.2"
        provider="siliconflow"
        documentCount={12}
        channelsRunning
      />,
    );

    expect(screen.getByText("System Overview")).toBeInTheDocument();
    expect(screen.getByText("deepseek-ai/DeepSeek-V3.2")).toBeInTheDocument();
    expect(screen.getByText("siliconflow")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("submits local model settings and reports field changes", () => {
    const onSubmit = vi.fn((event) => event.preventDefault());
    const onFormChange = vi.fn();

    render(
      <LocalModelSettingsPanel
        settings={llmSettings}
        form={form}
        providers={providerOptions}
        selectedProvider={providerOptions[0]}
        apiKey=""
        clearApiKey={false}
        saving={false}
        keyStatus="Configured"
        apiKeyDisabled={false}
        onSubmit={onSubmit}
        onProviderChange={vi.fn()}
        onApplyProviderDefaults={vi.fn()}
        onFormChange={onFormChange}
        onApiKeyChange={vi.fn()}
        onClearApiKeyChange={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Temperature"), { target: { value: "0.4" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onFormChange).toHaveBeenCalledWith({ temperature: 0.4 });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("submits data source settings and can clear saved tokens", () => {
    const onSubmit = vi.fn((event) => event.preventDefault());
    const onClearTushareTokenChange = vi.fn();

    render(
      <DataSourceSettingsPanel
        dataSettings={dataSettings}
        tushareToken=""
        clearTushareToken={false}
        saving={false}
        tushareStatus="Keep current token"
        onSubmit={onSubmit}
        onTushareTokenChange={vi.fn()}
        onClearTushareTokenChange={onClearTushareTokenChange}
      />,
    );

    fireEvent.click(screen.getByLabelText("Clear saved Tushare token"));
    fireEvent.click(screen.getByRole("button", { name: "Save data source settings" }));

    expect(onClearTushareTokenChange).toHaveBeenCalledWith(true);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
