import { MemoryRouter } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountMenu } from "../AccountMenu";

const labels = {
  account: "Account",
  login: "Sign in",
  logout: "Log out",
  light: "Light theme",
  dark: "Dark theme",
  language: "Language",
};

describe("AccountMenu", () => {
  it("groups account, theme, language, and logout actions in one floating menu", async () => {
    const user = userEvent.setup();
    const onToggleTheme = vi.fn();
    const onLanguageChange = vi.fn();
    const onLogout = vi.fn();
    render(
      <MemoryRouter>
        <AccountMenu
          principal={{ email: "owner@example.com", role: "owner", organization_id: "org" } as any}
          dark={false}
          currentLanguage="en"
          loggingOut={false}
          labels={labels}
          onToggleTheme={onToggleTheme}
          onLanguageChange={onLanguageChange}
          onLogout={onLogout}
          version="v1"
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /owner@example.com/ }));
    expect(await screen.findByRole("menu", { name: "Account" })).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Dark theme" }));
    expect(onToggleTheme).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: /owner@example.com/ }));
    await user.click(await screen.findByRole("menuitem", { name: "中文" }));
    expect(onLanguageChange).toHaveBeenCalledWith("zh-CN");

    await user.click(screen.getByRole("button", { name: /owner@example.com/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Log out" }));
    expect(onLogout).toHaveBeenCalledOnce();
  });
});
