import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FloatingLayer } from "../FloatingLayer";

function Harness({ matchTriggerWidth = false }: { matchTriggerWidth?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div data-testid="outside">
      <FloatingLayer
        open={open}
        onOpenChange={setOpen}
        trigger={<button type="button">Models</button>}
        contentLabel="Choose model"
        matchTriggerWidth={matchTriggerWidth}
        autoFocus="first"
      >
        <button type="button" role="menuitem">Model A</button>
        <button type="button" role="menuitem">Model B</button>
      </FloatingLayer>
    </div>
  );
}

describe("FloatingLayer", () => {
  it("renders through a portal and closes after an outside pointer interaction", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "Models" }));
    const menu = await screen.findByRole("menu", { name: "Choose model" });
    expect(menu.parentElement).toBe(document.body);
    expect(screen.getByRole("button", { name: "Models" })).toHaveAttribute("aria-expanded", "true");

    fireEvent.pointerDown(screen.getByTestId("outside"));
    expect(menu).toHaveAttribute("data-state", "closing");
    await waitFor(() => expect(screen.queryByRole("menu", { name: "Choose model" })).not.toBeInTheDocument());
  });

  it("closes with Escape and restores focus to its trigger", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Models" });

    await user.click(trigger);
    const firstItem = await screen.findByRole("menuitem", { name: "Model A" });
    await waitFor(() => expect(firstItem).toHaveFocus());

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu", { name: "Choose model" })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("can match the measured trigger width", async () => {
    const user = userEvent.setup();
    render(<Harness matchTriggerWidth />);
    const trigger = screen.getByRole("button", { name: "Models" });
    trigger.getBoundingClientRect = () => ({
      x: 20,
      y: 100,
      width: 180,
      height: 36,
      top: 100,
      right: 200,
      bottom: 136,
      left: 20,
      toJSON: () => ({}),
    });

    await user.click(trigger);
    const menu = await screen.findByRole("menu", { name: "Choose model" });
    await waitFor(() => expect(menu).toHaveStyle({ minWidth: "180px" }));
  });
});
