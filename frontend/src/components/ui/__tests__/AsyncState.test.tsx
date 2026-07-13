import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmptyState, InlineError, Skeleton, RefreshingOverlay } from "../AsyncState";

describe("AsyncState", () => {
  it("renders a dimensionally stable skeleton", () => {
    render(<Skeleton width={160} height={24} />);

    const skeleton = screen.getByLabelText("Loading");
    expect(skeleton).toHaveStyle({ width: "160px", height: "24px" });
  });

  it("presents one clear empty-state action", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<EmptyState title="No documents" description="Import a source to begin." actionLabel="Import" onAction={onAction} />);

    await user.click(screen.getByRole("button", { name: "Import" }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("keeps errors and background refreshes local to their region", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const { rerender } = render(<InlineError title="Knowledge unavailable" message="Connection failed" retryLabel="Retry" onRetry={onRetry} />);

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();

    rerender(<RefreshingOverlay label="Refreshing knowledge" />);
    expect(screen.getByRole("status")).toHaveTextContent("Refreshing knowledge");
  });
});
