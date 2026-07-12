import { fireEvent, render, screen } from "@testing-library/react";
import { ChannelsSettingsPanel } from "../ChannelsSettingsPanel";
import type { ChannelRuntimeStatus } from "@/lib/api";

function channelStatus(overrides: Partial<ChannelRuntimeStatus> = {}): ChannelRuntimeStatus {
  return {
    running: false,
    inbound_queue: 0,
    outbound_queue: 0,
    session_count: 0,
    channels: {
      websocket: {
        name: "websocket",
        display_name: "WebSocket",
        configured: true,
        enabled: true,
        available: true,
        loaded: true,
        running: false,
      },
      telegram: {
        name: "telegram",
        display_name: "Telegram",
        configured: true,
        enabled: false,
        available: false,
        loaded: false,
        running: false,
        error: "ModuleNotFoundError",
        install_hint: "pip install 'hyper-trading-agent[telegram]'",
      },
    },
    ...overrides,
  };
}

describe("ChannelsSettingsPanel", () => {
  it("renders channel runtime status, configuration hints, and actions", () => {
    const onRefresh = vi.fn();
    const onSetRunning = vi.fn();

    render(
      <ChannelsSettingsPanel
        channelStatus={channelStatus()}
        loadError=""
        refreshing={false}
        action={null}
        onRefresh={onRefresh}
        onSetRunning={onSetRunning}
      />,
    );

    expect(screen.getByText("IM Channels")).toBeInTheDocument();
    expect(screen.getByText("How to use IM channels")).toBeInTheDocument();
    expect(screen.getByText("/pairing approve <code> / /pairing list / /new")).toBeInTheDocument();
    expect(screen.getByText("channels.telegram.enabled / botToken / allowUsers")).toBeInTheDocument();
    expect(screen.getByText("pip install 'hyper-trading-agent[telegram]'")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    fireEvent.click(screen.getByRole("button", { name: "Start channels" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop channels" }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onSetRunning).toHaveBeenNthCalledWith(1, "start");
    expect(onSetRunning).toHaveBeenNthCalledWith(2, "stop");
  });

  it("keeps actions disabled when status is unavailable", () => {
    render(
      <ChannelsSettingsPanel
        channelStatus={null}
        loadError="Runtime unavailable"
        refreshing={false}
        action={null}
        onRefresh={vi.fn()}
        onSetRunning={vi.fn()}
      />,
    );

    expect(screen.getByText("Runtime unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start channels" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Stop channels" })).toBeDisabled();
  });
});
