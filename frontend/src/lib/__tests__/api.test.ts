import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api";

async function loadApiModule() {
  vi.resetModules();
  return import("../api");
}

describe("api request helper", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => ""),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("rejects non-JSON responses with a descriptive error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<!doctype html><html><body>SPA</body></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      ),
    );

    const { api } = await loadApiModule();

    await expect(api.getChannelStatus()).rejects.toMatchObject({
      name: "ApiError",
      status: 200,
      message: expect.stringContaining("Expected JSON from /channels/status, got text/html"),
    } satisfies Partial<ApiError>);
  });

  it("calls organization member management endpoints", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ));
    vi.stubGlobal("fetch", fetchMock);

    const { api } = await loadApiModule();

    await api.listOrganizationMembers();
    await api.createOrganizationMember({ email: "member@example.com", password: "password123", role: "viewer" });
    await api.updateOrganizationMember("usr_1", { role: "member" });
    await api.deleteOrganizationMember("usr_1");

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/organizations/current/members", expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/organizations/current/members", expect.objectContaining({ method: "POST" }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/organizations/current/members/usr_1", expect.objectContaining({ method: "PATCH" }));
    expect(fetchMock).toHaveBeenNthCalledWith(4, "/organizations/current/members/usr_1", expect.objectContaining({ method: "DELETE" }));
  });
});
