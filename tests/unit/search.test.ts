import { describe, it, expect } from "vitest";
import { buildSearchClause, columnSearchKind, escapeLike, termVariants, tokenizeSearch } from "@/lib/search";
import { placeholder } from "@/lib/sql";

describe("columnSearchKind", () => {
  it.each([
    ["character varying", "text"], ["text", "text"], ["nvarchar", "text"], ["varchar(255)", "text"],
    ["integer", "integer"], ["bigint", "integer"], ["int", "integer"], ["INT(11)", "integer"], ["tinyint", "integer"],
    ["numeric", "decimal"], ["double precision", "decimal"], ["REAL", "decimal"], ["money", "decimal"],
    ["timestamp with time zone", "temporal"], ["datetime2", "temporal"], ["date", "temporal"],
    ["uuid", "cast"], ["uniqueidentifier", "cast"], ["macaddr", "cast"], ["inet", "cast"], ["USER-DEFINED", "cast"], ["enum", "cast"],
    ["boolean", "none"], ["bit", "none"], ["bytea", "none"], ["varbinary", "none"], ["jsonb", "none"], ["ARRAY", "none"], ["interval", "none"],
  ])("%s → %s", (type, kind) => {
    expect(columnSearchKind({ type })).toBe(kind);
  });

  it("treats MSSQL timestamp (rowversion) as unsearchable", () => {
    expect(columnSearchKind({ type: "timestamp" }, "mssql")).toBe("none");
    expect(columnSearchKind({ type: "timestamp" }, "postgres")).toBe("temporal");
  });
});

describe("tokenizeSearch", () => {
  it("splits on whitespace and keeps quoted phrases", () => {
    expect(tokenizeSearch(`  john "new york"  42 `)).toEqual(["john", "new york", "42"]);
  });
  it("dedupes case-insensitively and caps the term count", () => {
    expect(tokenizeSearch("a A b")).toEqual(["a", "b"]);
    expect(tokenizeSearch("1 2 3 4 5 6 7 8 9 10")).toHaveLength(8);
  });
});

describe("escapeLike", () => {
  it("escapes %, _ and the escape char", () => {
    expect(escapeLike("a%b_c!d", "postgres")).toBe("a!%b!_c!!d");
  });
  it("also escapes [ for mssql only", () => {
    expect(escapeLike("[x]", "mssql")).toBe("![x]");
    expect(escapeLike("[x]", "mysql")).toBe("[x]");
  });
});

describe("buildSearchClause per database", () => {
  const targets = [
    { sql: "c_text", type: "varchar" },
    { sql: "c_uuid", type: "uuid" },
    { sql: "c_int", type: "int" },
    { sql: "c_dt", type: "datetime" },
  ];
  const build = (dbType: string, search: string) => {
    const queryParams: unknown[] = [];
    const sql = buildSearchClause({ dbType, placeholder: (i) => placeholder(dbType, i), targets, search, queryParams });
    return { sql, queryParams };
  };

  it("postgres uses ILIKE and CAST AS TEXT", () => {
    const { sql } = build("postgres", "7");
    expect(sql).toBe(`(c_text ILIKE $1 ESCAPE '!' OR CAST(c_uuid AS TEXT) ILIKE $2 ESCAPE '!' OR c_int = $3)`);
  });

  it("mysql uses LIKE and CAST AS CHAR", () => {
    expect(build("mysql", "x").sql).toBe(`(c_text LIKE ? ESCAPE '!' OR CAST(c_uuid AS CHAR) LIKE ? ESCAPE '!')`);
  });

  it("mssql casts to NVARCHAR and formats dates with style 121", () => {
    expect(build("mssql", "2026-01").sql).toBe(
      `(c_text LIKE @p0 ESCAPE '!' OR CAST(c_uuid AS NVARCHAR(MAX)) LIKE @p1 ESCAPE '!' OR CONVERT(NVARCHAR(50), c_dt, 121) LIKE @p2 ESCAPE '!')`
    );
  });

  it("sqlite uses LIKE and CAST AS TEXT", () => {
    expect(build("sqlite", "x").sql).toBe(`(c_text LIKE ? ESCAPE '!' OR CAST(c_uuid AS TEXT) LIKE ? ESCAPE '!')`);
  });

  it("returns null for an empty search", () => {
    expect(build("postgres", "   ").sql).toBeNull();
  });

  it("passes integers within the safe range as numbers", () => {
    expect(build("postgres", "12").queryParams).toContain(12);
  });
});

describe("termVariants", () => {
  it("expands a full MAC into colon, dash, bare and Cisco notations", () => {
    expect(termVariants("80-F3-DA-50-0E-3C")).toEqual([
      "80-F3-DA-50-0E-3C", "80:F3:DA:50:0E:3C", "80F3DA500E3C", "80F3.DA50.0E3C",
    ]);
    expect(termVariants("80f3da500e3c")).toContain("80:f3:da:50:0e:3c");
    expect(termVariants("80f3.da50.0e3c")).toContain("80:f3:da:50:0e:3c");
  });
  it("expands a MAC prefix of 3+ groups", () => {
    expect(termVariants("80:f3:da")).toEqual(["80:f3:da", "80-f3-da", "80f3da"]);
  });
  it("leaves ordinary terms and times alone", () => {
    expect(termVariants("hello")).toEqual(["hello"]);
    expect(termVariants("10:15")).toEqual(["10:15"]);
    expect(termVariants("80:f3-da")).toEqual(["80:f3-da"]);
  });
});
