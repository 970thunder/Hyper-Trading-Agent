import { MemoryRouter } from "react-router-dom";
import { Database, Home } from "lucide-react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PrimaryNavigation, type NavigationGroup } from "../PrimaryNavigation";

const groups: NavigationGroup[] = [
  {
    id: "workspace",
    label: "Workspace",
    items: [
      { to: "/", label: "Home", icon: Home },
      { to: "/knowledge", label: "Knowledge", icon: Database },
    ],
  },
];

describe("PrimaryNavigation", () => {
  it("marks the current route and notifies mobile drawers after navigation", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(
      <MemoryRouter initialEntries={["/knowledge"]}>
        <PrimaryNavigation groups={groups} pathname="/knowledge" onNavigate={onNavigate} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Knowledge" })).toHaveAttribute("aria-current", "page");
    await user.click(screen.getByRole("link", { name: "Home" }));
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it("keeps accessible names when visually collapsed", () => {
    render(
      <MemoryRouter>
        <PrimaryNavigation groups={groups} pathname="/" collapsed />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("title", "Home");
    expect(screen.queryByText("Workspace")).not.toBeInTheDocument();
  });
});
