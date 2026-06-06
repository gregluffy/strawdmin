import { describe, it, expect } from "vitest";
import {
  quoteIdentifier,
  placeholder,
  serializeRow,
  isBinaryType,
  deserializeBinary,
} from "@/lib/sql";

describe("quoteIdentifier", () => {
  it("wraps in double-quotes for postgres", () => {
    const q = quoteIdentifier("postgres");
    expect(q("table_name")).toBe('"table_name"');
  });

  it("wraps in double-quotes for sqlite", () => {
    const q = quoteIdentifier("sqlite");
    expect(q("col")).toBe('"col"');
  });

  it("wraps in backticks for mysql", () => {
    const q = quoteIdentifier("mysql");
    expect(q("col")).toBe("`col`");
  });

  it("wraps in backticks for mariadb", () => {
    const q = quoteIdentifier("mariadb");
    expect(q("col")).toBe("`col`");
  });

  it("wraps in square brackets for mssql", () => {
    const q = quoteIdentifier("mssql");
    expect(q("col")).toBe("[col]");
  });

  it("is case-insensitive (MSSQL)", () => {
    const q = quoteIdentifier("MSSQL");
    expect(q("col")).toBe("[col]");
  });

  it("trims whitespace from dbType", () => {
    const q = quoteIdentifier("  mysql  ");
    expect(q("col")).toBe("`col`");
  });

  it("handles identifier with spaces", () => {
    const q = quoteIdentifier("postgres");
    expect(q("my table")).toBe('"my table"');
  });
});

describe("placeholder", () => {
  it("returns $1 for postgres i=0", () => {
    expect(placeholder("postgres", 0)).toBe("$1");
  });

  it("returns $3 for postgres i=2", () => {
    expect(placeholder("postgres", 2)).toBe("$3");
  });

  it("returns @p0 for mssql i=0", () => {
    expect(placeholder("mssql", 0)).toBe("@p0");
  });

  it("returns @p5 for mssql i=5", () => {
    expect(placeholder("mssql", 5)).toBe("@p5");
  });

  it("returns ? for mysql", () => {
    expect(placeholder("mysql", 0)).toBe("?");
  });

  it("returns ? for sqlite (default)", () => {
    expect(placeholder("sqlite", 0)).toBe("?");
  });

  it("returns ? for mariadb", () => {
    expect(placeholder("mariadb", 3)).toBe("?");
  });
});

describe("serializeRow", () => {
  it("converts Uint8Array to base64", () => {
    const arr = new Uint8Array([104, 101, 108, 108, 111]); // "hello"
    const result = serializeRow({ data: arr });
    expect(result.data).toBe(Buffer.from(arr).toString("base64"));
  });

  it("converts Buffer to base64", () => {
    const buf = Buffer.from("hello");
    const result = serializeRow({ data: buf });
    expect(result.data).toBe(buf.toString("base64"));
  });

  it("leaves strings unchanged", () => {
    expect(serializeRow({ name: "alice" }).name).toBe("alice");
  });

  it("leaves numbers unchanged", () => {
    expect(serializeRow({ count: 42 }).count).toBe(42);
  });

  it("leaves null unchanged", () => {
    expect(serializeRow({ val: null }).val).toBeNull();
  });

  it("leaves booleans unchanged", () => {
    expect(serializeRow({ flag: true }).flag).toBe(true);
  });

  it("handles mixed row correctly", () => {
    const buf = Buffer.from("data");
    const result = serializeRow({ id: 1, name: "bob", raw: buf });
    expect(result.id).toBe(1);
    expect(result.name).toBe("bob");
    expect(result.raw).toBe(buf.toString("base64"));
  });
});

describe("isBinaryType", () => {
  it("returns true for binary", () => {
    expect(isBinaryType("binary")).toBe(true);
  });

  it("returns true for varbinary", () => {
    expect(isBinaryType("varbinary")).toBe(true);
  });

  it("returns true for image", () => {
    expect(isBinaryType("image")).toBe(true);
  });

  it("is case-insensitive (BINARY)", () => {
    expect(isBinaryType("BINARY")).toBe(true);
  });

  it("returns false for varchar", () => {
    expect(isBinaryType("varchar")).toBe(false);
  });

  it("returns false for text", () => {
    expect(isBinaryType("text")).toBe(false);
  });

  it("returns false for integer", () => {
    expect(isBinaryType("integer")).toBe(false);
  });
});

describe("deserializeBinary", () => {
  const base64Hello = Buffer.from("hello").toString("base64");

  it("decodes base64 string when colType is binary", () => {
    const result = deserializeBinary(base64Hello, "binary");
    expect(Buffer.isBuffer(result)).toBe(true);
    expect((result as Buffer).toString()).toBe("hello");
  });

  it("decodes base64 string when colType is varbinary", () => {
    const result = deserializeBinary(base64Hello, "varbinary");
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  it("returns string unchanged when colType is varchar", () => {
    expect(deserializeBinary(base64Hello, "varchar")).toBe(base64Hello);
  });

  it("returns number unchanged even for binary type", () => {
    expect(deserializeBinary(42, "binary")).toBe(42);
  });

  it("returns null unchanged for binary type", () => {
    expect(deserializeBinary(null, "binary")).toBeNull();
  });
});
