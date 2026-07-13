import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { FormEvent } from "react";
import { SwarmAgentsPanel, type SwarmAgentFormState } from "../SwarmAgentsPanel";
import type { CommercialModelProvider, SwarmPreset, SwarmPresetAgentList } from "@/lib/api";

const presets: SwarmPreset[] = [
  {
    name: "quant_strategy_desk",
    title: "Quant Strategy Desk",
    description: "Multi-agent quant research team.",
    agent_count: 1,
    variables: [],
  },
];

const agentList: SwarmPresetAgentList = {
  preset_name: "quant_strategy_desk",
  title: "Quant Strategy Desk",
  description: "Multi-agent quant research team.",
  agents: [
    {
      id: "screener",
      role: "Stock Screener",
      system_prompt: "Find candidates.",
      tools: ["market_data"],
      skills: ["screening"],
      max_iterations: 12,
      timeout_seconds: 300,
      model_name: "deepseek-ai/DeepSeek-V3.2",
      model_provider_id: "provider-1",
      max_retries: 2,
      task_count: 3,
    },
  ],
};

const form: SwarmAgentFormState = {
  id: "",
  role: "",
  system_prompt: "",
  tools: "",
  skills: "",
  max_iterations: 25,
  timeout_seconds: 300,
  model_name: "",
  model_provider_id: "",
  max_retries: 2,
};

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

describe("SwarmAgentsPanel", () => {
  it("renders swarm agents and exposes edit/new interactions", async () => {
    const onRefresh = vi.fn();
    const onPresetChange = vi.fn();
    const onResetForm = vi.fn();
    const onEditAgent = vi.fn();
    const onDeleteAgent = vi.fn();
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());
    const onFormChange = vi.fn();
    const onModelChange = vi.fn();

    const onFormOpenChange = vi.fn();
    const { container } = render(
      <SwarmAgentsPanel
        presets={presets}
        selectedPreset="quant_strategy_desk"
        agentList={agentList}
        form={form}
        editingAgentId={null}
        saving={false}
        deletingAgentId={null}
        commercialModelProviders={providers}
        modelOptions={["deepseek-ai/DeepSeek-V3.2"]}
        selectedModelValue=""
        formOpen
        onFormOpenChange={onFormOpenChange}
        onRefresh={onRefresh}
        onPresetChange={onPresetChange}
        onResetForm={onResetForm}
        onEditAgent={onEditAgent}
        onDeleteAgent={onDeleteAgent}
        onSubmit={onSubmit}
        onFormChange={onFormChange}
        onModelChange={onModelChange}
      />,
    );

    expect(screen.getByText("Swarm Agent Management")).toBeInTheDocument();
    expect(screen.getByText("Stock Screener")).toBeInTheDocument();
    expect(screen.getAllByText(/siliconflow \/ deepseek-ai\/DeepSeek-V3.2/).length).toBeGreaterThan(0);
    expect(container.querySelector("select")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Model:/i }));
    expect(screen.getByRole("option", { name: /siliconflow \/ deepseek-ai\/DeepSeek-V3.2/ })).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole("listbox", { name: "Model" })).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /New agent/i }));
    expect(onResetForm).toHaveBeenCalled();
    expect(onFormOpenChange).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByRole("button", { name: "Edit screener" }));
    expect(onEditAgent).toHaveBeenCalledWith(agentList.agents[0]);
  });
});
