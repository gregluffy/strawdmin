import { NextRequest, NextResponse } from "next/server";
import { getDriver } from "@/lib/drivers";
import { getTable } from "@/lib/introspect";
import { getActiveConnection } from "@/lib/active-connection";
import { getRequestUser } from "@/lib/request-auth";

export async function GET(req: NextRequest) {
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const refTable = searchParams.get("refTable");
  const field = searchParams.get("field");
  const idsParam = searchParams.get("ids");

  if (!refTable || !field || !idsParam) {
    return NextResponse.json({ error: "Missing refTable, field, or ids" }, { status: 400 });
  }

  const ids = idsParam.split(",").slice(0, 200).filter(Boolean);
  if (ids.length === 0) return NextResponse.json({});

  const conn = await getActiveConnection(req);
  if (!conn) return NextResponse.json({ error: "No active database connection" }, { status: 400 });

  try {
    const schema = await getTable(refTable, conn);
    if (!schema) return NextResponse.json({ error: "Table not found" }, { status: 404 });

    const validCols = new Set(schema.columns.map((c) => c.name));
    if (!validCols.has(field)) {
      return NextResponse.json({ error: "Invalid field" }, { status: 400 });
    }

    const driver = getDriver(conn);
    const pk = schema.primaryKey;
    const placeholders = ids.map((_, i) => driver.placeholder(i)).join(", ");
    const sql = `SELECT ${driver.quote(pk)}, ${driver.quote(field)} FROM ${driver.quote(refTable)} WHERE ${driver.quote(pk)} IN (${placeholders})`;
    const rows = await driver.query<Record<string, unknown>>(sql, ids);

    const result: Record<string, string> = {};
    for (const row of rows) {
      const key = String(row[pk]);
      const val = row[field];
      result[key] = val === null || val === undefined ? "" : String(val);
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
