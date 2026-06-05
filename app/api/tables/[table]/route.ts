import { NextRequest, NextResponse } from "next/server";
import { getDriver } from "@/lib/drivers";
import { getTable } from "@/lib/introspect";
import { serializeRow, deserializeBinary } from "@/lib/sql";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ table: string }> }
) {
  const { table } = await params;
  try {
    const schema = await getTable(table);
    if (!schema) return NextResponse.json({ error: "Table not found" }, { status: 404 });

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") ?? "";
    const sort = searchParams.get("sort") ?? schema.primaryKey;
    const dir = searchParams.get("dir") === "asc" ? "ASC" : "DESC";
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
    const pageSize = Math.min(200, Math.max(1, parseInt(searchParams.get("pageSize") ?? "50")));
    const offset = (page - 1) * pageSize;

    const validColumns = new Set(schema.columns.map((c) => c.name));
    const sortCol = validColumns.has(sort) ? sort : schema.primaryKey;

    const driver = getDriver();

    let countSql = `SELECT COUNT(*) as total FROM ${driver.quote(table)}`;
    let rowsSql = `SELECT * FROM ${driver.quote(table)}`;
    const queryParams: unknown[] = [];

    if (search) {
      const textCols = schema.columns.filter(
        (c) => !c.isJson && ["text", "varchar", "nvarchar", "char", "string"].some(
          (t) => c.type.toLowerCase().includes(t)
        )
      );
      if (textCols.length > 0) {
        const conditions = textCols.map((c, i) => {
          queryParams.push(`%${search}%`);
          return `${driver.quote(c.name)} LIKE ${driver.placeholder(i)}`;
        });
        const where = ` WHERE ${conditions.join(" OR ")}`;
        countSql += where;
        rowsSql += where;
      }
    }

    rowsSql += ` ORDER BY ${driver.quote(sortCol)} ${dir}`;
    if (driver.dbType === "mssql") {
      rowsSql += ` OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY`;
    } else {
      rowsSql += ` LIMIT ${pageSize} OFFSET ${offset}`;
    }

    const [countResult, rows] = await Promise.all([
      driver.query<{ total: number | string }>(countSql, queryParams),
      driver.query(rowsSql, queryParams),
    ]);

    const total = Number(countResult[0]?.total ?? 0);
    return NextResponse.json({ rows: rows.map((r) => serializeRow(r as Record<string, unknown>)), total, page, pageSize });
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
  try {
    const schema = await getTable(table);
    if (!schema) return NextResponse.json({ error: "Table not found" }, { status: 404 });

    const body = await req.json();
    const driver = getDriver();

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
    return NextResponse.json({ ok: true, row: result[0] ?? null }, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
