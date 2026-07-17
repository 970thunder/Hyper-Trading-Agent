import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PlatformAdminShell } from "@/components/admin/PlatformAdminShell";

const apiMock = vi.hoisted(() => ({
  getCommercialMe: vi.fn(),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: apiMock };
});

describe("PlatformAdmin standalone shell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.getCommercialMe.mockResolvedValue({
      user_id: "user_platform",
      organization_id: "org_1",
      email: "platform@example.com",
      role: "owner",
      is_platform_admin: true,
    });
  });

  it("renders the platform console without the product desktop sidebar", async () => {
    render(
      <MemoryRouter>
        <PlatformAdminShell>
          <div data-testid="platform-page-body">Platform body</div>
        </PlatformAdminShell>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("platform-admin-shell")).toBeInTheDocument();
    expect(screen.getByTestId("platform-page-body")).toBeInTheDocument();
    expect(screen.queryByTestId("desktop-sidebar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mobile-header")).not.toBeInTheDocument();
    expect(screen.queryByTestId("app-shell")).not.toBeInTheDocument();
  });
});
