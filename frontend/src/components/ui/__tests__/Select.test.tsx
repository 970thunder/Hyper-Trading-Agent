import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Select, type SelectOption } from "../Select";

const options: SelectOption[] = [
  { value: "v3", label: "DeepSeek V3.2", description: "SiliconFlow" },
  { value: "r1", label: "DeepSeek R1", description: "SiliconFlow" },
  { value: "disabled", label: "Unavailable model", disabled: true },
];

function Harness({ searchable = false }: { searchable?: boolean }) {
  const [value, setValue] = useState("v3");
  return (
    <Select
      value={value}
      onValueChange={setValue}
      options={options}
      label="Model"
      searchable={searchable}
      searchPlaceholder="Search models"
      emptyLabel="No matching models"
    />
  );
}

describe("Select", () => {
  it("selects options with keyboard navigation", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: /Model/ });
    expect(trigger).toHaveTextContent("DeepSeek V3.2");

    await user.click(trigger);
    const current = await screen.findByRole("option", { name: /DeepSeek V3.2/ });
    await waitFor(() => expect(current).toHaveFocus());
    await user.keyboard("{ArrowDown}{Enter}");

    expect(trigger).toHaveTextContent("DeepSeek R1");
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  });

  it("filters searchable options and reports an empty result", async () => {
    const user = userEvent.setup();
    render(<Harness searchable />);
    await user.click(screen.getByRole("button", { name: /Model/ }));

    const search = await screen.findByPlaceholderText("Search models");
    await user.clear(search);
    await user.type(search, "R1");
    expect(screen.getByRole("option", { name: /DeepSeek R1/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /DeepSeek V3.2/ })).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "missing");
    expect(screen.getByText("No matching models")).toBeInTheDocument();
  });

  it("does not allow disabled options to be selected", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: /Model/ });
    await user.click(trigger);

    const disabled = await screen.findByRole("option", { name: "Unavailable model" });
    expect(disabled).toHaveAttribute("aria-disabled", "true");
    await user.click(disabled);
    expect(trigger).toHaveTextContent("DeepSeek V3.2");
  });
});
