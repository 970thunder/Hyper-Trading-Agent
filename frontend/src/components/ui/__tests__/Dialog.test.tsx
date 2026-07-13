import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dialog } from "../Dialog";
import { Drawer } from "../Drawer";

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open import</button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Import document"
        description="Configure parsing and vectorization."
        closeLabel="Close import"
        footer={<button type="button">Start import</button>}
      >
        <label>Title<input autoFocus /></label>
      </Dialog>
    </>
  );
}

describe("Dialog", () => {
  it("moves focus into the dialog, traps it, and restores it on Escape", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    const trigger = screen.getByRole("button", { name: "Open import" });

    await user.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Import document" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    await waitFor(() => expect(screen.getByLabelText("Title")).toHaveFocus());

    fireEvent.keyDown(document, { key: "Escape" });
    expect(dialog).toHaveAttribute("data-state", "closing");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Import document" })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("closes only when the scrim itself is pressed", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    await user.click(screen.getByRole("button", { name: "Open import" }));
    const dialog = await screen.findByRole("dialog", { name: "Import document" });

    fireEvent.pointerDown(dialog);
    expect(dialog).toBeInTheDocument();

    const scrim = dialog.parentElement;
    expect(scrim).toHaveAttribute("data-dialog-scrim");
    fireEvent.pointerDown(scrim!);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Import document" })).not.toBeInTheDocument());
  });
});

describe("Drawer", () => {
  it("uses the requested edge and shared modal accessibility contract", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open navigation</button>
          <Drawer open={open} onOpenChange={setOpen} title="Navigation" closeLabel="Close navigation" side="left">
            <a href="/agent">Agent</a>
          </Drawer>
        </>
      );
    }

    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    const drawer = await screen.findByRole("dialog", { name: "Navigation" });
    expect(drawer).toHaveAttribute("data-drawer-content");
    expect(drawer).toHaveAttribute("data-side", "left");
  });
});
