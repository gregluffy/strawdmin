import { NextRequest, NextResponse } from "next/server";
import { getDriver } from "@/lib/drivers";
import { getTable } from "@/lib/introspect";
import { serializeRow } from "@/lib/sql";
import { getRequestUser } from "@/lib/request-auth";
import { getUserTablePolicy, getUserColumnPolicies } from "@/lib/internal-db";
import { getActiveConnection } from "@/lib/active-connection";
import { buildSearchAndFilterClause, parseFilters } from "@/lib/table-query";
import { toCsvRow } from "@/lib/csv";
import type { FilterLogic } from "@/lib/types";

const BATCH_SIZE = 1000;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ table: string }> }
) {
  const { table } = await params;
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conn = await getActiveConnection(req);
  if (!conn) return NextResponse.json({ error: "No active database connection" }, { status: 400 });

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
  const filterLogic: FilterLogic = searchParams.get("filterLogic") === "OR" ? "OR" : "AND";

  const validColumns = new Set(schema.columns.map((c) => c.name));
  const sortCol = validColumns.has(sort) ? sort : schema.primaryKey;
  const filters = parseFilters(searchParams.get("filters"), validColumns);

  const driver = getDriver(conn);

  let hiddenCols = new Set<string>();
  if (user.role !== "admin") {
    const colPolicies = await getUserColumnPolicies(user.sub, table, conn.id);
    hiddenCols = new Set(Object.entries(colPolicies).filter(([, p]) => p.hidden).map(([col]) => col));
  }
  const exportCols = schema.columns.filter((c) => !hiddenCols.has(c.name));
  if (exportCols.length === 0) {
    return NextResponse.json({ error: "No exportable columns" }, { status: 403 });
  }

  const { joinClause, tableRef, whereSql, queryParams } = await buildSearchAndFilterClause({
    driver, table, schema, conn, search, filters, filterLogic,
  });

  const colsSql = exportCols.map((c) => `${tableRef}${driver.quote(c.name)}`).join(", ");
  const baseSql = `SELECT ${colsSql} FROM ${driver.quote(table)}${joinClause}${whereSql} ORDER BY ${tableRef}${driver.quote(sortCol)} ${dir}`;

  const encoder = new TextEncoder();
  let cancelled = false;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(toCsvRow(exportCols.map((c) => c.name))));

        let offset = 0;
        for (;;) {
          if (cancelled) break;
          const batchSql = driver.dbType === "mssql"
            ? `${baseSql} OFFSET ${offset} ROWS FETCH NEXT ${BATCH_SIZE} ROWS ONLY`
            : `${baseSql} LIMIT ${BATCH_SIZE} OFFSET ${offset}`;

          const rows = await driver.query(batchSql, queryParams);
          if (rows.length === 0) break;

          for (const r of rows) {
            const row = serializeRow(r as Record<string, unknown>);
            controller.enqueue(encoder.encode(toCsvRow(exportCols.map((c) => row[c.name]))));
          }

          if (rows.length < BATCH_SIZE) break;
          offset += BATCH_SIZE;
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${table}.csv"`,
    },
  });
}
