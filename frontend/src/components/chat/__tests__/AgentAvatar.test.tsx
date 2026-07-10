import { render, screen } from "@testing-library/react";
import { AgentAvatar } from "../AgentAvatar";

describe("AgentAvatar", () => {
  it("renders the Hyper Trading initial", () => {
    render(<AgentAvatar />);
    expect(screen.getByText("H")).toBeInTheDocument();
  });

  it("uses token-based surface styling", () => {
    const { container } = render(<AgentAvatar />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toMatch(/bg-primary\/10/);
    expect(el.className).not.toMatch(/bg-gradient/);
  });
});
