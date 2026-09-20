import { describe, it, expect, afterEach, vi } from "vitest";
import { anyModalOpen } from "./modalGuard";

// Stubs document.querySelector in pure node test environment without jsdom —
// verifies what selectors anyModalOpen queries and how results map to booleans
// (actual CSS engine behavior is not under test).
const stubQuerySelector = (returnValue: Element | null) => {
  const querySelector = vi.fn(() => returnValue);
  vi.stubGlobal("document", { querySelector });
  return querySelector;
};

describe("anyModalOpen", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("queries for a fullscreen backdrop that isn't pointer-events-none", () => {
    const querySelector = stubQuerySelector(null);
    anyModalOpen();
    expect(querySelector).toHaveBeenCalledWith(".fixed.inset-0:not(.pointer-events-none)");
  });

  it("returns true when a matching element is found", () => {
    stubQuerySelector({} as Element);
    expect(anyModalOpen()).toBe(true);
  });

  it("returns false when nothing matches (e.g. only a drag overlay is present)", () => {
    stubQuerySelector(null);
    expect(anyModalOpen()).toBe(false);
  });
});
