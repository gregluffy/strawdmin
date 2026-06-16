import { NextRequest, NextResponse } from "next/server";
import { getDriver } from "@/lib/drivers";
import { getTable } from "@/lib/introspect";
import { getActiveConnection } from "@/lib/active-connection";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ table: string }> }
) {
  const { table } = await params;

  const conn = await getActiveConnection(req);
  if (!conn) return NextResponse.json({ error: "No active database connection" }, { status: 400 });

  try {
    const schema = await getTable(table, conn);
    if (!schema) return NextResponse.json({ error: "Table not found" }, { status: 404 });

    const driver = getDriver(conn);
    const [pkCol, labelCol] = schema.columns;
    const selectCols = labelCol
      ? `${driver.quote(pkCol.name)}, ${driver.quote(labelCol.name)}`
      : driver.quote(pkCol.name);

    let sql = `SELECT ${selectCols} FROM ${driver.quote(table)}`;
    if (driver.dbType === "mssql") sql += " ORDER BY (SELECT NULL) OFFSET 0 ROWS FETCH NEXT 500 ROWS ONLY";
    else sql += " LIMIT 500";

    const rows = await driver.query(sql);
    return NextResponse.json(rows);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
