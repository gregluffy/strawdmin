import { describe, it, expect } from "vitest";
import { temporalKind, toDateInputValue, fromDateInputValue } from "@/lib/datetime";

describe("temporalKind", () => {
  it("maps datetime-ish column types", () => {
    expect(temporalKind("timestamp")).toBe("datetime");
    expect(temporalKind("timestamp without time zone")).toBe("datetime");
    expect(temporalKind("TIMESTAMPTZ")).toBe("datetime");
    expect(temporalKind("datetime")).toBe("datetime");
    expect(temporalKind("datetime2")).toBe("datetime");
    expect(temporalKind("datetimeoffset")).toBe("datetime");
  });

  it("maps date columns", () => {
    expect(temporalKind("date")).toBe("date");
    expect(temporalKind("DATE")).toBe("date");
  });

  it("leaves other types alone", () => {
    expect(temporalKind("time")).toBeNull();
    expect(temporalKind("varchar(255)")).toBeNull();
    expect(temporalKind("int")).toBeNull();
    expect(temporalKind("interval")).toBeNull();
  });
});

describe("toDateInputValue", () => {
  it("formats a Date from pg/mysql2 in local time", () => {
    const d = new Date(2026, 6, 14, 9, 5, 3);
    expect(toDateInputValue(d, "datetime")).toBe("2026-07-14T09:05:03");
    expect(toDateInputValue(d, "date")).toBe("2026-07-14");
  });

  it("accepts space-separated strings from sqlite/mysql", () => {
    expect(toDateInputValue("2026-07-14 12:00:00", "datetime")).toBe("2026-07-14T12:00:00");
    expect(toDateInputValue("2026-07-14 12:00", "datetime")).toBe("2026-07-14T12:00:00");
  });

  it("reformats ISO strings without reinterpreting the wall clock", () => {
    expect(toDateInputValue("2026-07-14T12:00:00.000Z", "datetime")).toBe("2026-07-14T12:00:00");
    expect(toDateInputValue("2026-07-14T12:00:00.000Z", "date")).toBe("2026-07-14");
  });

  it("pads a date-only value into a datetime field", () => {
    expect(toDateInputValue("2026-07-14", "datetime")).toBe("2026-07-14T00:00:00");
  });

  it("handles epoch millis", () => {
    const ms = new Date(2026, 0, 2, 3, 4, 5).getTime();
    expect(toDateInputValue(ms, "datetime")).toBe("2026-01-02T03:04:05");
  });

  it("does not expand partially-typed input into a bogus date", () => {
    // new Date("2") is 2001-02-01 — the parser must not be trusted with fragments.
    expect(toDateInputValue("2", "datetime")).toBe("");
    expect(toDateInputValue("20", "datetime")).toBe("");
    expect(toDateInputValue("202", "date")).toBe("");
    expect(toDateInputValue("2026-0", "datetime")).toBe("");
  });

  it("returns empty for null, empty and unparseable values", () => {
    expect(toDateInputValue(null, "datetime")).toBe("");
    expect(toDateInputValue(undefined, "datetime")).toBe("");
    expect(toDateInputValue("", "datetime")).toBe("");
    expect(toDateInputValue("not a date", "datetime")).toBe("");
    expect(toDateInputValue(new Date("nope"), "datetime")).toBe("");
    expect(toDateInputValue("2026-07-14", null)).toBe("");
  });
});

describe("fromDateInputValue", () => {
  it("emits a literal every driver accepts", () => {
    expect(fromDateInputValue("2026-07-14T12:00:00", "datetime")).toBe("2026-07-14 12:00:00");
    expect(fromDateInputValue("2026-07-14", "date")).toBe("2026-07-14");
  });

  it("maps an empty field to null", () => {
    expect(fromDateInputValue("", "datetime")).toBeNull();
    expect(fromDateInputValue("   ", "date")).toBeNull();
  });

  it("round-trips an untouched driver value", () => {
    const stored = "2026-07-14 09:05:03";
    expect(fromDateInputValue(toDateInputValue(stored, "datetime"), "datetime")).toBe(stored);
  });
});
