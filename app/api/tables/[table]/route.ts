import { NextRequest, NextResponse } from "next/server";
import { getDriver } from "@/lib/drivers";
import { getTable } from "@/lib/introspect";
import { serializeRow, deserializeBinary } from "@/lib/sql";
import { getRequestUser } from "@/lib/request-auth";
import { getUserTablePolicy, getUserColumnPolicies, logAudit } from "@/lib/internal-db";
import { getActiveConnection } from "@/lib/active-connection";
import { buildSearchAndFilterClause, parseFilters } from "@/lib/table-query";
import type { FilterLogic } from "@/lib/types";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ table: string }> }
) {
  const { table } = await params;
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conn = await getActiveConnection(req);
  if (!conn) return NextResponse.json({ error: "No active database connection" }, { status: 400 });

  try {
    const schema = await getTable(table, conn);
    if (!schema) return NextResponse.json({ error: "Table not found" }, { status: 404 });

    if (user.role !== "admin") {
      const policy = await getUserTablePolicy(user.sub, table, conn.id);
      if (!policy.can_view) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") ?? "";
    const sort = searchParams.get("sort") ?? schema.primaryKey;
    const dir = searchParams.get("dir") === "asc" ? "ASC" : "DESC";
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
    const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") ?? "50")));
    const offset = (page - 1) * pageSize;
    const filterLogic: FilterLogic = searchParams.get("filterLogic") === "OR" ? "OR" : "AND";

    const validColumns = new Set(schema.columns.map((c) => c.name));
    const sortCol = validColumns.has(sort) ? sort : schema.primaryKey;
    const filters = parseFilters(searchParams.get("filters"), validColumns);

    const driver = getDriver(conn);

    const { joinClause, tableRef, whereSql, queryParams } = await buildSearchAndFilterClause({
      driver, table, schema, conn, search, filters, filterLogic,
    });

    const countSql = `SELECT COUNT(*) as total FROM ${driver.quote(table)}${joinClause}${whereSql}`;
    let rowsSql = `SELECT ${tableRef}* FROM ${driver.quote(table)}${joinClause}${whereSql}`;

    rowsSql += ` ORDER BY ${tableRef}${driver.quote(sortCol)} ${dir}`;
    if (driver.dbType === "mssql") {
      rowsSql += ` OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY`;
    } else {
      rowsSql += ` LIMIT ${pageSize} OFFSET ${offset}`;
    }

    const [countResult, rows] = await Promise.all([
      driver.query<{ total: number | string }>(countSql, queryParams),
      driver.query(rowsSql, queryParams),
    ]);

    let hiddenCols = new Set<string>();
    if (user.role !== "admin") {
      const colPolicies = await getUserColumnPolicies(user.sub, table, conn.id);
      hiddenCols = new Set(Object.entries(colPolicies).filter(([, p]) => p.hidden).map(([col]) => col));
    }

    const serialized = rows.map((r) => {
      const row = serializeRow(r as Record<string, unknown>);
      for (const col of hiddenCols) delete row[col];
      return row;
    });

    const total = Number(countResult[0]?.total ?? 0);
    return NextResponse.json({ rows: serialized, total, page, pageSize });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ table: string }> }
) {
  const { table } = await params;
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conn = await getActiveConnection(req);
  if (!conn) return NextResponse.json({ error: "No active database connection" }, { status: 400 });

  try {
    const schema = await getTable(table, conn);
    if (!schema) return NextResponse.json({ error: "Table not found" }, { status: 404 });

    if (user.role !== "admin") {
      const policy = await getUserTablePolicy(user.sub, table, conn.id);
      if (!policy.can_insert) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const driver = getDriver(conn);

    const missing = schema.columns.filter(
      (c) =>
        !c.isAutoIncrement &&
        !c.nullable &&
        !c.defaultValue &&
        (body[c.name] === undefined || body[c.name] === null || body[c.name] === "")
    );
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Required fields cannot be empty: ${missing.map((c) => c.name).join(", ")}` },
        { status: 400 }
      );
    }

    const insertCols = schema.columns.filter(
      (c) => !c.isAutoIncrement && body[c.name] !== undefined && (body[c.name] !== null || c.nullable)
    );
    const cols = insertCols.map((c) => driver.quote(c.name)).join(", ");
    const values = insertCols.map((c) => {
      const v = body[c.name];
      if (c.isJson && typeof v === "object") return JSON.stringify(v);
      return deserializeBinary(v, c.type);
    });
    const phs = insertCols.map((_, i) => driver.placeholder(i)).join(", ");

    const returning = driver.dbType === "postgres" ? " RETURNING *" : "";
    const sql = `INSERT INTO ${driver.quote(table)} (${cols}) VALUES (${phs})${returning}`;

    const result = await driver.query(sql, values);
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? null;
    logAudit({ userId: user.sub, username: user.username, action: "INSERT", tableName: table, changes: { after: body }, ip }, conn.id).catch(() => {});
    return NextResponse.json({ ok: true, row: result[0] ?? null }, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
