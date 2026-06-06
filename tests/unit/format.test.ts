import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { formatRelativeTime, formatSize } from "@/lib/format";

describe("formatRelativeTime", () => {
  const BASE = new Date("2024-01-01T12:00:00.000Z").getTime();

  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  function ago(ms: number) {
    return new Date(BASE - ms).toISOString();
  }

  it("returns seconds for < 60s", () => {
    expect(formatRelativeTime(ago(30_000))).toBe("30s ago");
  });

  it("returns 0s for 0ms diff", () => {
    expect(formatRelativeTime(ago(0))).toBe("0s ago");
  });

  it("returns 59s at boundary just below 1m", () => {
    expect(formatRelativeTime(ago(59_999))).toBe("59s ago");
  });

  it("returns 1m at exactly 60s", () => {
    expect(formatRelativeTime(ago(60_000))).toBe("1m ago");
  });

  it("returns 1m for 90s", () => {
    expect(formatRelativeTime(ago(90_000))).toBe("1m ago");
  });

  it("returns 59m just below 1h", () => {
    expect(formatRelativeTime(ago(59 * 60_000 + 59_000))).toBe("59m ago");
  });

  it("returns 1h at exactly 3600s", () => {
    expect(formatRelativeTime(ago(3_600_000))).toBe("1h ago");
  });

  it("returns 23h just below 1d", () => {
    expect(formatRelativeTime(ago(23 * 3_600_000 + 59 * 60_000))).toBe("23h ago");
  });

  it("returns 1d at exactly 24h", () => {
    expect(formatRelativeTime(ago(86_400_000))).toBe("1d ago");
  });

  it("returns 2d for 2 days", () => {
    expect(formatRelativeTime(ago(2 * 86_400_000))).toBe("2d ago");
  });
});

describe("formatSize", () => {
  it("returns bytes for 0", () => {
    expect(formatSize(0)).toBe("0 B");
  });

  it("returns bytes for 500", () => {
    expect(formatSize(500)).toBe("500 B");
  });

  it("returns bytes for 1023 (just below KB)", () => {
    expect(formatSize(1023)).toBe("1023 B");
  });

  it("returns 1.0 KB at exact KB boundary", () => {
    expect(formatSize(1024)).toBe("1.0 KB");
  });

  it("returns 1.5 KB for 1536 bytes", () => {
    expect(formatSize(1536)).toBe("1.5 KB");
  });

  it("returns KB for just below MB boundary", () => {
    expect(formatSize(1024 * 1024 - 1)).toBe("1024.0 KB");
  });

  it("returns 1.0 MB at exact MB boundary", () => {
    expect(formatSize(1024 * 1024)).toBe("1.0 MB");
  });

  it("returns 1.5 MB for 1.5 MiB", () => {
    expect(formatSize(1024 * 1024 * 1.5)).toBe("1.5 MB");
  });
});
