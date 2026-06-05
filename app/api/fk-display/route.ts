import { NextRequest, NextResponse } from "next/server";
import { getDriver } from "@/lib/drivers";
import { getTable } from "@/lib/introspect";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const refTable = searchParams.get("refTable");
  const field = searchParams.get("field");
  const idsParam = searchParams.get("ids");

  if (!refTable || !field || !idsParam) {
    return NextResponse.json({ error: "Missing refTable, field, or ids" }, { status: 400 });
  }

  const ids = idsParam.split(",").slice(0, 200).filter(Boolean);
  if (ids.length === 0) return NextResponse.json({});

  try {
    const schema = await getTable(refTable);
    if (!schema) return NextResponse.json({ error: "Table not found" }, { status: 404 });

    const validCols = new Set(schema.columns.map((c) => c.name));
    if (!validCols.has(field)) {
      return NextResponse.json({ error: "Invalid field" }, { status: 400 });
    }

    const driver = getDriver();
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
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
