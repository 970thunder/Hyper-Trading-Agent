import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentContextControls } from "../AgentContextControls";

const providers = [
  { id: "p1", provider: "openai", model: "gpt-5.5", base_url: "https://example.com", enabled: true, is_default: true },
  { id: "p2", provider: "siliconflow", model: "deepseek-ai/DeepSeek-V3.2", base_url: "https://api.siliconflow.cn/v1", enabled: true, is_default: false },
] as any;

describe("AgentContextControls", () => {
  it("keeps execution and model menus mutually exclusive", async () => {
    const user = userEvent.setup();
    render(
      <AgentContextControls
        executionMode="auto"
        executionOptions={[{ value: "auto", label: "Auto" }, { value: "react", label: "ReAct" }]}
        onExecutionModeChange={vi.fn()}
        providers={providers}
        selectedProviderId="p1"
        onProviderChange={vi.fn()}
        controlsLocked={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Auto/ }));
    expect(await screen.findByRole("menu")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /gpt-5.5/ }));
    expect(await screen.findByRole("listbox")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("applies the selected provider and closes the floating list", async () => {
    const user = userEvent.setup();
    const onProviderChange = vi.fn();
    render(
      <AgentContextControls
        executionMode="auto"
        executionOptions={[{ value: "auto", label: "Auto" }]}
        onExecutionModeChange={vi.fn()}
        providers={providers}
        selectedProviderId="p1"
        onProviderChange={onProviderChange}
        controlsLocked={false}
      />,
    );

    await user.click(screen.getByRole("button", { name: /gpt-5.5/ }));
    await user.click(await screen.findByRole("option", { name: /DeepSeek-V3.2/ }));
    expect(onProviderChange).toHaveBeenCalledWith("p2");
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  });

  it("locks both controls during execution", () => {
    render(
      <AgentContextControls
        executionMode="auto"
        executionOptions={[{ value: "auto", label: "Auto" }]}
        onExecutionModeChange={vi.fn()}
        providers={providers}
        selectedProviderId="p1"
        onProviderChange={vi.fn()}
        controlsLocked
      />,
    );

    expect(screen.getByRole("button", { name: /Auto/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /gpt-5.5/ })).toBeDisabled();
  });
});
