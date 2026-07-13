import { render, screen } from "@testing-library/react";
import { Field, Input, NumberInput, Textarea } from "../Field";

describe("Field", () => {
  it("associates a generated id, label, and hint with its input", () => {
    render(
      <Field label="Provider name" hint="Shown to organization members">
        <Input />
      </Field>,
    );

    const input = screen.getByLabelText("Provider name");
    const hint = screen.getByText("Shown to organization members");
    expect(input).toHaveAttribute("aria-describedby", hint.id);
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("replaces the hint with an accessible error state", () => {
    render(
      <Field label="API key" hint="Stored securely" error="API key is required" required>
        <Input />
      </Field>,
    );

    const input = screen.getByLabelText(/API key/);
    const error = screen.getByRole("alert");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", error.id);
    expect(screen.queryByText("Stored securely")).not.toBeInTheDocument();
  });

  it("supports textarea and numeric controls without changing field semantics", () => {
    render(
      <>
        <Field label="Description"><Textarea /></Field>
        <Field label="Top K"><NumberInput min={1} /></Field>
      </>,
    );

    expect(screen.getByLabelText("Description").tagName).toBe("TEXTAREA");
    expect(screen.getByLabelText("Top K")).toHaveAttribute("type", "number");
  });
});
