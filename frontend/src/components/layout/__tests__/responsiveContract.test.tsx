import { render, screen } from "@testing-library/react";
import { AppShell } from "../AppShell";

describe("AppShell responsive contract", () => {
  it("removes the desktop sidebar from mobile layout flow", () => {
    render(
      <AppShell
        desktopSidebar={<nav>Desktop navigation</nav>}
        mobileHeader={<button type="button">Open navigation</button>}
        banner={<div>Connection status</div>}
      >
        <section>Workspace</section>
      </AppShell>,
    );

    const desktopSidebar = screen.getByTestId("desktop-sidebar");
    const mobileHeader = screen.getByTestId("mobile-header");
    const workspace = screen.getByRole("main");

    expect(desktopSidebar).toHaveClass("hidden", "md:flex");
    expect(mobileHeader).toHaveClass("flex", "md:hidden");
    expect(workspace).toHaveClass("min-w-0");
    expect(screen.getByText("Workspace")).toBeInTheDocument();
  });
});
