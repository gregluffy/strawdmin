import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const mockQuery = vi.fn();

vi.mock("@/lib/drivers", () => ({ getDriver: vi.fn() }));
vi.mock("@/lib/request-auth", () => ({ getRequestUser: vi.fn() }));
vi.mock("@/lib/active-connection", () => ({ getActiveConnection: vi.fn() }));
vi.mock("@/lib/introspect", () => ({ getTable: vi.fn() }));
vi.mock("@/lib/internal-db", () => ({
  getUserTablePolicy: vi.fn(),
  getUserColumnPolicies: vi.fn(),
  logAudit: vi.fn(),
  getFkSettings: vi.fn(),
}));

import { GET } from "@/app/api/tables/[table]/route";
import { getDriver } from "@/lib/drivers";
import { getRequestUser } from "@/lib/request-auth";
import { getActiveConnection } from "@/lib/active-connection";
import { getTable } from "@/lib/introspect";
import { getFkSettings, getUserTablePolicy, getUserColumnPolicies } from "@/lib/internal-db";

const ORDERS_SCHEMA = {
  name: "orders",
  primaryKey: "id",
  columns: [
    { name: "id", type: "integer", nullable: false, isPrimary: true, isAutoIncrement: true, isJson: false },
    { name: "notes", type: "text", nullable: true, isPrimary: false, isAutoIncrement: false, isJson: false },
    { name: "customer_id", type: "integer", nullable: true, isPrimary: false, isAutoIncrement: false, isJson: false,
      fk: { table: "customers", column: "id" } },
  ],
};

const CUSTOMERS_SCHEMA = {
  name: "customers",
  primaryKey: "id",
  columns: [
    { name: "id", type: "integer", nullable: false, isPrimary: true, isAutoIncrement: true, isJson: false },
    { name: "name", type: "varchar", nullable: true, isPrimary: false, isAutoIncrement: false, isJson: false },
  ],
};

function makeRequest(table: string, params: Record<string, string> = {}) {
  const url = new URL(`http://localhost/api/tables/${table}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url.toString());
}

function routeParams(table: string) {
  return { params: Promise.resolve({ table }) };
}

function capturedSql() {
  return (mockQuery.mock.calls as [string, unknown[]][]).map(([sql]) => sql);
}

beforeEach(() => {
  vi.resetAllMocks();

  vi.mocked(getDriver).mockReturnValue({
    dbType: "postgres",
    quote: (id: string) => `"${id}"`,
    placeholder: (i: number) => `$${i + 1}`,
    query: mockQuery,
    close: vi.fn(),
  } as any);

  vi.mocked(getRequestUser).mockResolvedValue({ sub: 1, username: "admin", role: "admin" as const });
  vi.mocked(getActiveConnection).mockResolvedValue({
    id: 1, name: "test", db_type: "postgres" as const,
    connection_string: "postgres://localhost/test", created_at: "",
  });
  vi.mocked(getTable).mockResolvedValue(ORDERS_SCHEMA as any);
  vi.mocked(getFkSettings).mockResolvedValue([]);
  vi.mocked(getUserTablePolicy).mockResolvedValue({ can_view: true, can_insert: true, can_update: true, can_delete: true });
  vi.mocked(getUserColumnPolicies).mockResolvedValue({});

  mockQuery.mockImplementation((sql: string) => {
    if (sql.includes("COUNT(*)")) return Promise.resolve([{ total: 0 }]);
    return Promise.resolve([]);
  });
});

describe("GET /api/tables/[table] — no search", () => {
  it("returns 200 with rows/total/page/pageSize shape", async () => {
    const res = await GET(makeRequest("orders"), routeParams("orders"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ rows: [], total: 0, page: 1, pageSize: 50 });
  });

  it("does not call getFkSettings", async () => {
    await GET(makeRequest("orders"), routeParams("orders"));
    expect(vi.mocked(getFkSettings)).not.toHaveBeenCalled();
  });

  it("generates SELECT without JOIN or WHERE", async () => {
    await GET(makeRequest("orders"), routeParams("orders"));
    for (const sql of capturedSql()) {
      expect(sql).not.toContain("JOIN");
      expect(sql).not.toContain("WHERE");
    }
  });
});

describe("GET /api/tables/[table] — search on text columns", () => {
  it("adds case-insensitive ILIKE conditions for text columns (postgres)", async () => {
    await GET(makeRequest("orders", { search: "hello" }), routeParams("orders"));
    const rows = capturedSql().find((s) => !s.includes("COUNT(*)"))!;
    expect(rows).toContain(`"notes" ILIKE $1 ESCAPE '!'`);
    expect(rows).toContain("WHERE");
  });

  it("does not JOIN when there are no FK display settings", async () => {
    await GET(makeRequest("orders", { search: "hello" }), routeParams("orders"));
    for (const sql of capturedSql()) expect(sql).not.toContain("JOIN");
  });

  it("passes the search value wrapped in % as a bound parameter", async () => {
    await GET(makeRequest("orders", { search: "foo" }), routeParams("orders"));
    const allParams = (mockQuery.mock.calls as [string, unknown[]][]).flatMap(([, p]) => p ?? []);
    expect(allParams).toContain("%foo%");
  });

  it("matches no rows when the term cannot match any column", async () => {
    const numericSchema = {
      name: "metrics",
      primaryKey: "id",
      columns: [
        { name: "id", type: "integer", nullable: false, isPrimary: true, isAutoIncrement: true, isJson: false },
        { name: "value", type: "float", nullable: true, isPrimary: false, isAutoIncrement: false, isJson: false },
      ],
    };
    vi.mocked(getTable).mockResolvedValue(numericSchema as any);

    const res = await GET(makeRequest("metrics", { search: "foo" }), routeParams("metrics"));
    expect(res.status).toBe(200);
    for (const sql of capturedSql()) expect(sql).toContain("WHERE 1 = 0");
  });
});

describe("GET /api/tables/[table] — search with FK display setting", () => {
  beforeEach(() => {
    vi.mocked(getTable).mockImplementation(async (tableName) => {
      if (tableName === "orders") return ORDERS_SCHEMA as any;
      if (tableName === "customers") return CUSTOMERS_SCHEMA as any;
      return null;
    });
    vi.mocked(getFkSettings).mockResolvedValue([
      { column_name: "customer_id", display_path: ["name"] },
    ]);
  });

  it("LEFT JOINs the referenced table on the FK column", async () => {
    await GET(makeRequest("orders", { search: "john" }), routeParams("orders"));
    const rows = capturedSql().find((s) => !s.includes("COUNT(*)"))!;
    expect(rows).toContain('LEFT JOIN "customers" _fk0');
    expect(rows).toContain('ON "orders"."customer_id" = _fk0."id"');
  });

  it("includes the display field condition in WHERE", async () => {
    await GET(makeRequest("orders", { search: "john" }), routeParams("orders"));
    const rows = capturedSql().find((s) => !s.includes("COUNT(*)"))!;
    expect(rows).toContain('_fk0."name" ILIKE');
  });

  it("still includes native text column conditions alongside FK conditions", async () => {
    await GET(makeRequest("orders", { search: "john" }), routeParams("orders"));
    const rows = capturedSql().find((s) => !s.includes("COUNT(*)"))!;
    expect(rows).toContain('"orders"."notes" ILIKE');
  });

  it("applies the same JOIN to the COUNT query", async () => {
    await GET(makeRequest("orders", { search: "john" }), routeParams("orders"));
    const count = capturedSql().find((s) => s.includes("COUNT(*)"))!;
    expect(count).toContain('LEFT JOIN "customers" _fk0');
  });

  it("qualifies ORDER BY with the main table name when joins are present", async () => {
    await GET(makeRequest("orders", { search: "john" }), routeParams("orders"));
    const rows = capturedSql().find((s) => !s.includes("COUNT(*)"))!;
    expect(rows).toMatch(/"orders"\."id"/);
  });

  it("passes the search value as a bound parameter for each condition", async () => {
    await GET(makeRequest("orders", { search: "john" }), routeParams("orders"));
    const allParams = (mockQuery.mock.calls as [string, unknown[]][]).flatMap(([, p]) => p ?? []);
    const matches = allParams.filter((p) => p === "%john%");
    expect(matches.length).toBeGreaterThanOrEqual(2); // one per condition (notes + name)
  });

  it("returns 200", async () => {
    const res = await GET(makeRequest("orders", { search: "john" }), routeParams("orders"));
    expect(res.status).toBe(200);
  });
});

describe("GET /api/tables/[table] — FK display setting edge cases", () => {
  it("skips FK column that has no fk metadata in the schema", async () => {
    const schemaNoFkMeta = {
      ...ORDERS_SCHEMA,
      columns: ORDERS_SCHEMA.columns.map((c) =>
        c.name === "customer_id" ? { ...c, fk: undefined } : c
      ),
    };
    vi.mocked(getTable).mockResolvedValue(schemaNoFkMeta as any);
    vi.mocked(getFkSettings).mockResolvedValue([
      { column_name: "customer_id", display_path: ["name"] },
    ]);

    const res = await GET(makeRequest("orders", { search: "john" }), routeParams("orders"));
    expect(res.status).toBe(200);
    for (const sql of capturedSql()) expect(sql).not.toContain("JOIN");
  });

  it("skips FK display setting when the display field is not in the ref table schema", async () => {
    vi.mocked(getTable).mockImplementation(async (tableName) => {
      if (tableName === "orders") return ORDERS_SCHEMA as any;
      if (tableName === "customers") return CUSTOMERS_SCHEMA as any;
      return null;
    });
    vi.mocked(getFkSettings).mockResolvedValue([
      { column_name: "customer_id", display_path: ["nonexistent_field"] },
    ]);

    const res = await GET(makeRequest("orders", { search: "john" }), routeParams("orders"));
    expect(res.status).toBe(200);
    for (const sql of capturedSql()) expect(sql).not.toContain("JOIN");
  });

  it("skips FK display setting when the ref table is not found", async () => {
    vi.mocked(getTable).mockImplementation(async (tableName) => {
      if (tableName === "orders") return ORDERS_SCHEMA as any;
      return null; // ref table not found
    });
    vi.mocked(getFkSettings).mockResolvedValue([
      { column_name: "customer_id", display_path: ["name"] },
    ]);

    const res = await GET(makeRequest("orders", { search: "john" }), routeParams("orders"));
    expect(res.status).toBe(200);
    for (const sql of capturedSql()) expect(sql).not.toContain("JOIN");
  });
});

describe("GET /api/tables/[table] — multiple FK display settings", () => {
  it("adds a separate LEFT JOIN for each FK column with a display setting", async () => {
    const multiSchema = {
      name: "orders",
      primaryKey: "id",
      columns: [
        { name: "id", type: "integer", nullable: false, isPrimary: true, isAutoIncrement: true, isJson: false },
        { name: "customer_id", type: "integer", nullable: true, isPrimary: false, isAutoIncrement: false, isJson: false,
          fk: { table: "customers", column: "id" } },
        { name: "product_id", type: "integer", nullable: true, isPrimary: false, isAutoIncrement: false, isJson: false,
          fk: { table: "products", column: "id" } },
      ],
    };
    const productsSchema = {
      name: "products",
      primaryKey: "id",
      columns: [
        { name: "id", type: "integer", nullable: false, isPrimary: true, isAutoIncrement: true, isJson: false },
        { name: "title", type: "varchar", nullable: true, isPrimary: false, isAutoIncrement: false, isJson: false },
      ],
    };

    vi.mocked(getTable).mockImplementation(async (tableName) => {
      if (tableName === "orders") return multiSchema as any;
      if (tableName === "customers") return CUSTOMERS_SCHEMA as any;
      if (tableName === "products") return productsSchema as any;
      return null;
    });
    vi.mocked(getFkSettings).mockResolvedValue([
      { column_name: "customer_id", display_path: ["name"] },
      { column_name: "product_id", display_path: ["title"] },
    ]);

    await GET(makeRequest("orders", { search: "foo" }), routeParams("orders"));
    const rows = capturedSql().find((s) => !s.includes("COUNT(*)"))!;

    expect(rows).toContain('LEFT JOIN "customers" _fk0');
    expect(rows).toContain('LEFT JOIN "products" _fk1');
    expect(rows).toContain('_fk0."name" ILIKE');
    expect(rows).toContain('_fk1."title" ILIKE');
  });
});

describe("GET /api/tables/[table] — typed search", () => {
  const DEVICE_SCHEMA = {
    name: "DeviceStatuses",
    primaryKey: "Id",
    columns: [
      { name: "Id", type: "integer", nullable: false, isPrimary: true, isAutoIncrement: true, isJson: false },
      { name: "DeviceId", type: "integer", nullable: false, isPrimary: false, isAutoIncrement: false, isJson: false,
        fk: { table: "Devices", column: "Id" } },
      { name: "Mac", type: "macaddr", nullable: true, isPrimary: false, isAutoIncrement: false, isJson: false },
      { name: "Online", type: "boolean", nullable: true, isPrimary: false, isAutoIncrement: false, isJson: false },
      { name: "Payload", type: "jsonb", nullable: true, isPrimary: false, isAutoIncrement: false, isJson: true },
      { name: "SeenAt", type: "timestamp with time zone", nullable: true, isPrimary: false, isAutoIncrement: false, isJson: false },
    ],
  };
  const DEVICES_SCHEMA = {
    name: "Devices",
    primaryKey: "Id",
    columns: [
      { name: "Id", type: "integer", nullable: false, isPrimary: true, isAutoIncrement: true, isJson: false },
      { name: "Serial", type: "integer", nullable: false, isPrimary: false, isAutoIncrement: false, isJson: false },
    ],
  };

  beforeEach(() => {
    vi.mocked(getTable).mockImplementation(async (t) => {
      if (t === "DeviceStatuses") return DEVICE_SCHEMA as any;
      if (t === "Devices") return DEVICES_SCHEMA as any;
      return null;
    });
    vi.mocked(getFkSettings).mockResolvedValue([{ column_name: "DeviceId", display_path: ["Serial"] }]);
  });

  function rowsQuery() {
    const call = (mockQuery.mock.calls as [string, unknown[]][]).find(([s]) => !s.includes("COUNT(*)"))!;
    return { sql: call[0], params: call[1] };
  }

  it("never LIKE-compares an integer column (no `integer ~~ unknown`)", async () => {
    await GET(makeRequest("DeviceStatuses", { search: "80:f3:da:50:0e:3c" }), routeParams("DeviceStatuses"));
    const { sql, params } = rowsQuery();
    expect(sql).not.toMatch(/"Id" I?LIKE/);
    expect(sql).not.toMatch(/"DeviceId" I?LIKE/);
    expect(sql).not.toMatch(/_fk0\."Serial" I?LIKE/);
    expect(sql).toContain(`CAST("DeviceStatuses"."Mac" AS TEXT) ILIKE`);
    expect(params).toEqual(["%80:f3:da:50:0e:3c%", "%80-f3-da-50-0e-3c%", "%80f3da500e3c%", "%80f3.da50.0e3c%"]);
  });

  it("matches integer columns (including FK display) by equality for numeric terms", async () => {
    await GET(makeRequest("DeviceStatuses", { search: "42" }), routeParams("DeviceStatuses"));
    const { sql, params } = rowsQuery();
    expect(sql).toContain(`"DeviceStatuses"."Id" = `);
    expect(sql).toContain(`_fk0."Serial" = `);
    expect(params.filter((p) => p === 42).length).toBe(3);
  });

  it("skips integer equality for values outside the column range", async () => {
    await GET(makeRequest("DeviceStatuses", { search: "99999999999" }), routeParams("DeviceStatuses"));
    const { sql } = rowsQuery();
    expect(sql).not.toContain(`"Id" = `);
  });

  it("never searches json or boolean columns", async () => {
    await GET(makeRequest("DeviceStatuses", { search: "true" }), routeParams("DeviceStatuses"));
    const { sql } = rowsQuery();
    expect(sql).not.toContain(`"Payload"`);
    expect(sql).not.toContain(`"Online"`);
  });

  it("searches timestamps only for date-looking terms", async () => {
    await GET(makeRequest("DeviceStatuses", { search: "2026-09" }), routeParams("DeviceStatuses"));
    expect(rowsQuery().sql).toContain(`CAST("DeviceStatuses"."SeenAt" AS TEXT) ILIKE`);
    mockQuery.mockClear();
    await GET(makeRequest("DeviceStatuses", { search: "abc" }), routeParams("DeviceStatuses"));
    expect(rowsQuery().sql).not.toContain(`"SeenAt"`);
  });

  it("requires every word to match (AND of per-term ORs)", async () => {
    vi.mocked(getTable).mockResolvedValue(ORDERS_SCHEMA as any);
    vi.mocked(getFkSettings).mockResolvedValue([]);
    await GET(makeRequest("orders", { search: "foo bar" }), routeParams("orders"));
    const { sql, params } = rowsQuery();
    expect(sql).toContain(" AND ");
    expect(params).toEqual(["%foo%", "%bar%"]);
  });

  it("escapes LIKE wildcards in the search term", async () => {
    vi.mocked(getTable).mockResolvedValue(ORDERS_SCHEMA as any);
    vi.mocked(getFkSettings).mockResolvedValue([]);
    await GET(makeRequest("orders", { search: "50%_off!" }), routeParams("orders"));
    expect(rowsQuery().params).toEqual(["%50!%!_off!!%"]);
  });

  it("does not search or filter columns hidden from the user", async () => {
    vi.mocked(getRequestUser).mockResolvedValue({ sub: 2, username: "u", role: "user" as const });
    vi.mocked(getUserColumnPolicies).mockResolvedValue({ Mac: { hidden: true, read_only: false } });
    const filters = JSON.stringify([{ column: "Mac", operator: "contains", value: "80" }]);
    await GET(makeRequest("DeviceStatuses", { search: "80:f3", filters }), routeParams("DeviceStatuses"));
    expect(rowsQuery().sql).not.toContain(`"Mac"`);
  });
});

describe("GET /api/tables/[table] — filters", () => {
  it("casts non-text columns for substring filters", async () => {
    const filters = JSON.stringify([{ column: "id", operator: "contains", value: "4" }]);
    await GET(makeRequest("orders", { filters }), routeParams("orders"));
    const sql = capturedSql().find((s) => !s.includes("COUNT(*)"))!;
    expect(sql).toContain(`CAST("id" AS TEXT) ILIKE $1 ESCAPE '!'`);
  });

  it("returns 400 for a non-numeric comparison value on a numeric column", async () => {
    const filters = JSON.stringify([{ column: "id", operator: "gt", value: "abc" }]);
    const res = await GET(makeRequest("orders", { filters }), routeParams("orders"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not a valid integer/);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
