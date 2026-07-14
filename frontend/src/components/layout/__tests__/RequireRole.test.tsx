import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { RequireRole } from "@/components/layout/RequireRole";

const apiMock = vi.hoisted(() => ({
  getCommercialMe: vi.fn(),
  getAuthStatus: vi.fn(),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: apiMock };
});

function renderGuard(roles: Array<"owner" | "admin" | "member" | "viewer"> = ["owner", "admin", "member", "viewer"]) {
  return render(
    <MemoryRouter initialEntries={["/secure"]}>
      <Routes>
        <Route path="/login" element={<div>login page</div>} />
        <Route path="/secure" element={<RequireRole roles={roles}><div>secure page</div></RequireRole>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("RequireRole", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects anonymous users to login before rendering the workspace", async () => {
    apiMock.getAuthStatus.mockResolvedValue({ commercial_mode: true });
    apiMock.getCommercialMe.mockRejectedValue(new Error("Authentication required"));
    renderGuard();
    expect(await screen.findByText("login page")).toBeInTheDocument();
    expect(screen.queryByText("secure page")).not.toBeInTheDocument();
  });

  it("does not render the workspace when a local runtime has no user session", async () => {
    apiMock.getAuthStatus.mockResolvedValue({ commercial_mode: false });
    apiMock.getCommercialMe.mockRejectedValue(new Error("Authentication required"));
    renderGuard(["owner", "admin"]);
    expect(await screen.findByText("login page")).toBeInTheDocument();
    expect(screen.queryByText("secure page")).not.toBeInTheDocument();
  });

  it("enforces role restrictions in commercial mode", async () => {
    apiMock.getAuthStatus.mockResolvedValue({ commercial_mode: true });
    apiMock.getCommercialMe.mockResolvedValue({
      user_id: "viewer",
      organization_id: "org_1",
      email: "viewer@example.com",
      role: "viewer",
    });
    renderGuard(["owner", "admin"]);
    expect(await screen.findByText("Admin console unavailable")).toBeInTheDocument();
    expect(screen.queryByText("secure page")).not.toBeInTheDocument();
  });
});
