import { describe, it, expect } from "vitest";
import { paginationWindow } from "@/lib/pagination";

describe("paginationWindow", () => {
  it("shows every page when there are few", () => {
    expect(paginationWindow(3, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(paginationWindow(1, 11)).toHaveLength(11);
  });

  it("returns nothing for zero pages", () => {
    expect(paginationWindow(1, 0)).toEqual([]);
  });

  it("slides near the start", () => {
    expect(paginationWindow(1, 50)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, "gap", 49, 50]);
    expect(paginationWindow(6, 50)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, "gap", 49, 50]);
  });

  it("slides in the middle", () => {
    expect(paginationWindow(20, 50)).toEqual([1, 2, "gap", 18, 19, 20, 21, 22, "gap", 49, 50]);
  });

  it("slides near the end", () => {
    expect(paginationWindow(50, 50)).toEqual([1, 2, "gap", 43, 44, 45, 46, 47, 48, 49, 50]);
    expect(paginationWindow(45, 50)).toEqual([1, 2, "gap", 43, 44, 45, 46, 47, 48, 49, 50]);
  });

  it("keeps a constant slot count and always includes the current page", () => {
    for (let p = 1; p <= 100; p++) {
      const w = paginationWindow(p, 100);
      expect(w).toHaveLength(11);
      expect(w).toContain(p);
    }
  });

  it("clamps an out-of-range current page", () => {
    expect(paginationWindow(99, 5)).toEqual([1, 2, 3, 4, 5]);
  });
});
