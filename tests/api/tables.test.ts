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
  it("adds LIKE conditions for text columns", async () => {
    await GET(makeRequest("orders", { search: "hello" }), routeParams("orders"));
    const rows = capturedSql().find((s) => !s.includes("COUNT(*)"))!;
    expect(rows).toContain('"notes" LIKE');
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

  it("does not add WHERE when no text columns match and no FK conditions", async () => {
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
    for (const sql of capturedSql()) expect(sql).not.toContain("WHERE");
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
    expect(rows).toContain('_fk0."name" LIKE');
  });

  it("still includes native text column conditions alongside FK conditions", async () => {
    await GET(makeRequest("orders", { search: "john" }), routeParams("orders"));
    const rows = capturedSql().find((s) => !s.includes("COUNT(*)"))!;
    expect(rows).toContain('"orders"."notes" LIKE');
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
    expect(rows).toContain('_fk0."name" LIKE');
    expect(rows).toContain('_fk1."title" LIKE');
  });
});
