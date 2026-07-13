import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { SessionRail } from "../SessionRail";

const labels = {
  title: "Sessions",
  newChat: "New chat",
  empty: "No sessions",
  rename: "Rename",
  delete: "Delete",
  confirm: "Confirm",
  cancel: "Cancel",
};

describe("SessionRail", () => {
  it("clips long titles without displacing inline delete confirmation", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn().mockResolvedValue(undefined);
    const longTitle = "Build a diversified portfolio from a very long list of securities and compare every risk assumption";
    render(
      <MemoryRouter>
        <SessionRail
          sessions={[{ session_id: "s1", title: longTitle } as any]}
          activeSessionId="s1"
          streamingSessionId={null}
          loading={false}
          labels={labels}
          onRename={vi.fn()}
          onDelete={onDelete}
        />
      </MemoryRouter>,
    );

    const title = screen.getByText(longTitle);
    expect(title).toHaveClass("truncate");
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onDelete).toHaveBeenCalledWith("s1");
  });
});
