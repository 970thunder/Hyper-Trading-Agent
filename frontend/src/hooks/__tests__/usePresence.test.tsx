import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePresence } from "../usePresence";

describe("usePresence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("moves through opening, open, closing, and unmounted states", () => {
    const { result, rerender } = renderHook(
      ({ open }) => usePresence(open, { exitDuration: 100 }),
      { initialProps: { open: false } },
    );

    expect(result.current).toEqual({ mounted: false, state: "closed" });

    rerender({ open: true });
    expect(result.current).toEqual({ mounted: true, state: "opening" });

    act(() => vi.advanceTimersByTime(16));
    expect(result.current).toEqual({ mounted: true, state: "open" });

    rerender({ open: false });
    expect(result.current).toEqual({ mounted: true, state: "closing" });

    act(() => vi.advanceTimersByTime(99));
    expect(result.current.mounted).toBe(true);

    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toEqual({ mounted: false, state: "closed" });
  });

  it("closes immediately when reduced motion is requested", () => {
    const { result, rerender } = renderHook(
      ({ open }) => usePresence(open, { exitDuration: 100, reducedMotion: true }),
      { initialProps: { open: true } },
    );

    expect(result.current.mounted).toBe(true);
    rerender({ open: false });
    act(() => vi.runOnlyPendingTimers());
    expect(result.current).toEqual({ mounted: false, state: "closed" });
  });

  it("cleans up pending timers when unmounted", () => {
    const { rerender, unmount } = renderHook(
      ({ open }) => usePresence(open, { exitDuration: 100 }),
      { initialProps: { open: true } },
    );
    rerender({ open: false });
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
