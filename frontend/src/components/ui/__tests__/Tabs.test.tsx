import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tab, TabList, TabPanel, Tabs } from "../Tabs";

function Harness() {
  const [value, setValue] = useState("documents");
  return (
    <Tabs value={value} onValueChange={setValue}>
      <TabList aria-label="Knowledge views">
        <Tab value="documents">Documents</Tab>
        <Tab value="disabled" disabled>Disabled</Tab>
        <Tab value="jobs">Ingestion jobs</Tab>
      </TabList>
      <TabPanel value="documents">Document table</TabPanel>
      <TabPanel value="jobs">Job queue</TabPanel>
    </Tabs>
  );
}

describe("Tabs", () => {
  it("links active tabs and panels with correct ARIA state", () => {
    render(<Harness />);

    const documents = screen.getByRole("tab", { name: "Documents" });
    expect(documents).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Document table");
    expect(screen.queryByText("Job queue")).not.toBeVisible();
  });

  it("moves focus and selection with arrow keys while skipping disabled tabs", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const documents = screen.getByRole("tab", { name: "Documents" });
    documents.focus();

    await user.keyboard("{ArrowRight}");

    const jobs = screen.getByRole("tab", { name: "Ingestion jobs" });
    expect(jobs).toHaveFocus();
    expect(jobs).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Job queue");
  });
});
