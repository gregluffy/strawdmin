/**
 * Live test: Postgres tables outside the `public` schema. Runs the real introspection, driver and
 * table route; only auth, connection resolution and internal settings are mocked.
 *
 * Opt-in: IT_POSTGRES=postgres://postgres:pw@localhost:55432/postgres
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/request-auth", () => ({ getRequestUser: vi.fn() }));
vi.mock("@/lib/active-connection", () => ({ getActiveConnection: vi.fn() }));
vi.mock("@/lib/internal-db", () => ({
  getUserTablePolicy: vi.fn(),
  getUserColumnPolicies: vi.fn(),
  logAudit: vi.fn(),
  getFkSettings: vi.fn(),
}));

import { GET } from "@/app/api/tables/[table]/route";
import { getDriver, closeDriver } from "@/lib/drivers";
import { clearSchemaCache, introspect } from "@/lib/introspect";
import { getRequestUser } from "@/lib/request-auth";
import { getActiveConnection } from "@/lib/active-connection";
import { getFkSettings, getUserColumnPolicies } from "@/lib/internal-db";
import type { DbConnection } from "@/lib/types";

const connStr = process.env.IT_POSTGRES;

describe.skipIf(!connStr)("live schemas — postgres", () => {
  const conn: DbConnection = { id: 9100, name: "schemas", db_type: "postgres", connection_string: connStr ?? "", created_at: "" };

  beforeAll(async () => {
    const driver = getDriver(conn);
    for (const sql of [
      `DROP SCHEMA IF EXISTS it_catalog CASCADE`,
      `DROP SCHEMA IF EXISTS it_ingest CASCADE`,
      `DROP TABLE IF EXISTS it_plain`,
      `CREATE SCHEMA it_catalog`,
      `CREATE SCHEMA it_ingest`,
      `CREATE TABLE it_catalog.products (gtin text PRIMARY KEY, name text NOT NULL)`,
      `CREATE TABLE it_ingest.drafts (id integer PRIMARY KEY, gtin text NOT NULL REFERENCES it_catalog.products(gtin), note text)`,
      `CREATE TABLE it_plain (id integer PRIMARY KEY, label text)`,
      `INSERT INTO it_catalog.products VALUES ('5201004021328', 'Caprice'), ('5449000054227', 'Coca-Cola')`,
      `INSERT INTO it_ingest.drafts VALUES (1, '5201004021328', 'first'), (2, '5449000054227', 'second')`,
      `INSERT INTO it_plain VALUES (1, 'plain')`,
    ]) {
      await driver.query(sql);
    }
    clearSchemaCache(conn.id);
  }, 60_000);

  afterAll(async () => {
    const driver = getDriver(conn);
    await driver.query(`DROP SCHEMA IF EXISTS it_catalog CASCADE`);
    await driver.query(`DROP SCHEMA IF EXISTS it_ingest CASCADE`);
    await driver.query(`DROP TABLE IF EXISTS it_plain`);
    await closeDriver(conn.id);
  });

  beforeEach(() => {
    vi.mocked(getRequestUser).mockResolvedValue({ sub: 1, username: "admin", role: "admin" as const });
    vi.mocked(getActiveConnection).mockResolvedValue(conn);
    vi.mocked(getFkSettings).mockResolvedValue([{ column_name: "gtin", display_path: ["name"] }] as never);
    vi.mocked(getUserColumnPolicies).mockResolvedValue([] as never);
  });

  const get = (table: string, query = "") =>
    GET(new NextRequest(`http://localhost/api/tables/${encodeURIComponent(table)}${query}`), { params: Promise.resolve({ table }) });

  it("lists tables of every schema, public ones by their plain name", async () => {
    const names = (await introspect(conn)).tables.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["it_catalog.products", "it_ingest.drafts", "it_plain"]));
    expect(names.some((n) => n.startsWith("pg_") || n.startsWith("information_schema."))).toBe(false);
  });

  it("keeps primary and foreign keys across schemas", async () => {
    const drafts = (await introspect(conn)).tables.find((t) => t.name === "it_ingest.drafts")!;
    expect(drafts.primaryKey).toBe("id");
    expect(drafts.columns.find((c) => c.name === "gtin")?.fk).toEqual({ table: "it_catalog.products", column: "gtin" });
  });

  it("reads rows of a table outside public, with the FK display and a search", async () => {
    const res = await get("it_ingest.drafts", "?search=Caprice");
    const body = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.total).toBe(1);
    expect(body.rows[0].note).toBe("first");
  });

  it("still reads a public table", async () => {
    const res = await get("it_plain");
    expect(res.status).toBe(200);
    expect((await res.json()).rows[0].label).toBe("plain");
  });
});
