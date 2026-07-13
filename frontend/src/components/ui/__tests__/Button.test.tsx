import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { Button, IconButton } from "../Button";

describe("Button", () => {
  it("exposes its visual variant without losing native button behavior", () => {
    render(<Button variant="primary">Save changes</Button>);

    const button = screen.getByRole("button", { name: "Save changes" });
    expect(button).toHaveAttribute("data-variant", "primary");
    expect(button).toHaveAttribute("type", "button");
    expect(button).not.toBeDisabled();
  });

  it("keeps its label width stable while exposing a localized loading name", () => {
    render(
      <Button loading loadingLabel="Saving changes">
        Save changes
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Saving changes" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveTextContent("Save changes");
    expect(button.querySelector("[data-button-spinner]")).toBeInTheDocument();
  });

  it("forwards its ref to the native button", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Open</Button>);

    expect(ref.current).toBe(screen.getByRole("button", { name: "Open" }));
  });
});

describe("IconButton", () => {
  it("requires and applies an accessible label", () => {
    render(
      <IconButton label="Refresh data">
        <span aria-hidden="true">R</span>
      </IconButton>,
    );

    const button = screen.getByRole("button", { name: "Refresh data" });
    expect(button).toHaveAttribute("data-icon-button", "true");
    expect(button).toHaveAttribute("title", "Refresh data");
  });
});
