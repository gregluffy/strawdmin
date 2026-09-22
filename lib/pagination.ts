export type PageSlot = number | "gap";

/**
 * Page links to render, Laravel `UrlWindow` style: when there are few pages
 * show them all; otherwise always show the first and last two pages plus a
 * sliding window of `onEachSide` pages around the current one, with "gap"
 * markers for the elided ranges. The slot count stays constant while paging
 * so the controls don't jump around.
 *
 *   1 2 3 4 [5] 6 7 8 … 49 50
 *   1 2 … 18 19 [20] 21 22 … 49 50
 *   1 2 … 43 44 45 [46] 47 48 49 50
 */
export function paginationWindow(current: number, last: number, onEachSide = 2): PageSlot[] {
  if (last <= 0) return [];
  const page = Math.min(Math.max(1, current), last);
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

  if (last < onEachSide * 2 + 8) return range(1, last);

  const window = onEachSide + 4;
  if (page <= window) {
    return [...range(1, window + onEachSide), "gap", last - 1, last];
  }
  if (page > last - window) {
    return [1, 2, "gap", ...range(last - (window + onEachSide) + 1, last)];
  }
  return [1, 2, "gap", ...range(page - onEachSide, page + onEachSide), "gap", last - 1, last];
}
