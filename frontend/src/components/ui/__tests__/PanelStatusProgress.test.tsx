import { render, screen } from "@testing-library/react";
import { Metric, Panel, SectionHeader } from "../Panel";
import { Progress } from "../Progress";
import { StatusIndicator } from "../Status";

describe("Panel", () => {
  it("uses an explicit surface level and avoids implicit nested-card semantics", () => {
    render(<Panel surface="elevated">Model inventory</Panel>);

    const panel = screen.getByText("Model inventory");
    expect(panel).toHaveAttribute("data-surface", "elevated");
    expect(panel).toHaveClass("rounded-lg");
  });

  it("renders section actions and tabular financial metrics", () => {
    render(
      <>
        <SectionHeader title="Usage" description="Current billing period" actions={<button type="button">Export</button>} />
        <Metric label="Tokens" value="1,136,880" helper="Last 30 days" />
      </>,
    );

    expect(screen.getByRole("heading", { name: "Usage" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
    expect(screen.getByText("1,136,880")).toHaveClass("tabular-nums");
  });
});

describe("StatusIndicator", () => {
  it("exposes a semantic tone while keeping the label readable", () => {
    render(<StatusIndicator tone="success" label="Indexed" dot />);

    const status = screen.getByText("Indexed").closest("[data-tone]");
    expect(status).not.toBeNull();
    expect(status).toHaveAttribute("data-tone", "success");
    expect(status?.querySelector("[data-status-dot]")).toBeInTheDocument();
  });
});

describe("Progress", () => {
  it("clamps its visual and accessible value", () => {
    render(<Progress value={124} label="Vectorizing" showValue />);

    const progress = screen.getByRole("progressbar", { name: "Vectorizing" });
    expect(progress).toHaveAttribute("aria-valuenow", "100");
    expect(progress.querySelector("[data-progress-fill]")).toHaveStyle({ width: "100%" });
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("supports an indeterminate state without inventing a percentage", () => {
    render(<Progress label="Parsing" indeterminate />);

    const progress = screen.getByRole("progressbar", { name: "Parsing" });
    expect(progress).not.toHaveAttribute("aria-valuenow");
    expect(progress.querySelector("[data-indeterminate=true]")).toBeInTheDocument();
  });
});
