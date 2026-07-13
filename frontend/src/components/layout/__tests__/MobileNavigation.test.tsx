import { MemoryRouter } from "react-router-dom";
import { Bot } from "lucide-react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MobileHeader, MobileNavigation } from "../MobileNavigation";

describe("MobileNavigation", () => {
  it("uses a drawer and closes it after route navigation", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <MemoryRouter>
        <MobileNavigation
          open
          onOpenChange={onOpenChange}
          groups={[{ id: "work", items: [{ to: "/agent", label: "Agent", icon: Bot }] }]}
          pathname="/"
          title="Navigation"
          closeLabel="Close navigation"
        />
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("link", { name: "Agent" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("provides stable navigation and session triggers in the mobile header", async () => {
    const user = userEvent.setup();
    const onOpenNavigation = vi.fn();
    const onOpenSessions = vi.fn();
    render(
      <MemoryRouter>
        <MobileHeader
          navigationLabel="Open navigation"
          sessionsLabel="Open sessions"
          onOpenNavigation={onOpenNavigation}
          onOpenSessions={onOpenSessions}
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    await user.click(screen.getByRole("button", { name: "Open sessions" }));
    expect(onOpenNavigation).toHaveBeenCalledOnce();
    expect(onOpenSessions).toHaveBeenCalledOnce();
  });
});
