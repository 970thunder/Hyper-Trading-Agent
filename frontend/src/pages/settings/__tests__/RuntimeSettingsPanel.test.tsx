import { render, screen } from "@testing-library/react";
import { RuntimeSettingsPanel } from "../RuntimeSettingsPanel";

describe("RuntimeSettingsPanel", () => {
  it("renders runtime job capability summary", () => {
    render(<RuntimeSettingsPanel />);

    expect(screen.getByText("Runtime / Background Jobs")).toBeInTheDocument();
    expect(screen.getByText("Agent runs")).toBeInTheDocument();
    expect(screen.getByText("RAG ingestion")).toBeInTheDocument();
    expect(screen.getByText("Worker")).toBeInTheDocument();
  });
});
