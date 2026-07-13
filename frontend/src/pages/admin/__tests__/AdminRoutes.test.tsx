import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import { within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Users } from "@/pages/admin/Users";

const apiMock = vi.hoisted(() => ({
  getCommercialMe: vi.fn(),
  getCurrentOrganization: vi.fn(),
  listOrganizationMembers: vi.fn(),
  createOrganizationMember: vi.fn(),
  updateOrganizationMember: vi.fn(),
  deleteOrganizationMember: vi.fn(),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, api: apiMock };
});

function setup(role: "owner" | "admin") {
  apiMock.getCommercialMe.mockResolvedValue({
    user_id: `user_${role}`,
    organization_id: "org_1",
    email: `${role}@example.com`,
    role,
  });
  apiMock.getCurrentOrganization.mockResolvedValue({ id: "org_1", name: "Hyper Research", created_at: "2026-07-13T00:00:00Z" });
  apiMock.listOrganizationMembers.mockResolvedValue([
    { user_id: "user_owner", email: "owner@example.com", display_name: "Research Owner", role: "owner", created_at: "2026-07-13T00:00:00Z" },
    { user_id: "user_member", email: "member@example.com", display_name: "Quant Analyst", role: "member", created_at: "2026-07-13T00:10:00Z" },
  ]);
}

describe("Dedicated administration routes", () => {
  beforeEach(() => vi.clearAllMocks());

  it("declares role-protected management routes outside Settings", () => {
    const source = readFileSync(resolve(process.cwd(), "src/router.tsx"), "utf8");
    for (const route of ["users", "models", "agents", "knowledge", "runtime", "audit", "usage"]) {
      expect(source).toContain(`path: \"${route}\"`);
    }
    expect(source).toContain('requireRole(AdminShell, ["owner", "admin"])');
  });

  it("lets an owner create members from the standalone user management page", async () => {
    const user = userEvent.setup();
    setup("owner");
    apiMock.createOrganizationMember.mockResolvedValue({
      user_id: "user_new",
      email: "new@example.com",
      display_name: "New Analyst",
      role: "member",
      created_at: "2026-07-13T01:00:00Z",
    });

    render(<Users />, { wrapper: MemoryRouter });

    expect(await screen.findByRole("heading", { name: "Organization members" })).toBeInTheDocument();
    expect(screen.getByText("Hyper Research")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add member" }));
    const dialog = await screen.findByRole("dialog", { name: "Add member" });
    const textboxes = within(dialog).getAllByRole("textbox");
    await user.type(textboxes[0], "new@example.com");
    await user.type(textboxes[1], "New Analyst");
    const passwordInput = dialog.querySelector<HTMLInputElement>('input[type="password"]');
    expect(passwordInput).not.toBeNull();
    await user.type(passwordInput!, "password123");
    await user.click(within(dialog).getByRole("button", { name: "Create member" }));

    await waitFor(() => expect(apiMock.createOrganizationMember).toHaveBeenCalledWith({
      email: "new@example.com",
      display_name: "New Analyst",
      password: "password123",
      role: "member",
    }));
  });

  it("keeps Admin member access read-only because only Owner can mutate membership", async () => {
    setup("admin");

    render(<Users />, { wrapper: MemoryRouter });

    expect(await screen.findByText("member@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add member" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove member@example.com" })).not.toBeInTheDocument();
    expect(screen.getByText("Only organization owners can add, change, or remove members.")).toBeInTheDocument();
  });
});
