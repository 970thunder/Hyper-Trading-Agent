import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SymbolMultiSelect } from "@/components/market/SymbolMultiSelect";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: { searchMarketSymbols: vi.fn() },
}));

describe("SymbolMultiSelect", () => {
  it("replaces the active fragment with a selected market symbol", async () => {
    vi.mocked(api.searchMarketSymbols).mockResolvedValue({
      query: "app",
      candidates: [{ symbol: "AAPL.US", name: "Apple", market: "us", type: "equity", source: "test" }],
      count: 1,
      sources: {},
    });
    const onChange = vi.fn();
    render(<SymbolMultiSelect value="BTC-USDT, app" onChange={onChange} ariaLabel="Symbols" />);

    fireEvent.focus(screen.getByRole("textbox", { name: "Symbols" }));
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 260)); });
    fireEvent.click(await screen.findByRole("option", { name: /AAPL.US/ }));

    expect(onChange).toHaveBeenCalledWith("BTC-USDT, AAPL.US, ");
  });

  it("removes a selected symbol from the input", () => {
    const onChange = vi.fn();
    render(<SymbolMultiSelect value="BTC-USDT, AAPL.US" onChange={onChange} ariaLabel="Symbols" />);

    fireEvent.click(screen.getByRole("button", { name: /AAPL.US/ }));

    expect(onChange).toHaveBeenCalledWith("BTC-USDT");
  });
});
