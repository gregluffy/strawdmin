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
  const pathParam = searchParams.get("path") ?? searchParams.get("field"); // field= for back-compat
  const idsParam = searchParams.get("ids");

  if (!refTable || !pathParam || !idsParam) {
    return NextResponse.json({ error: "Missing refTable, path, or ids" }, { status: 400 });
  }

  const path = pathParam.split(",").filter(Boolean);
  if (path.length === 0 || path.length > 2) {
    return NextResponse.json({ error: "path must have 1 or 2 segments" }, { status: 400 });
  }

  const ids = idsParam.split(",").slice(0, 200).filter(Boolean);
  if (ids.length === 0) return NextResponse.json({});

  const conn = await getActiveConnection(req);
  if (!conn) return NextResponse.json({ error: "No active database connection" }, { status: 400 });

  try {
    const refSchema = await getTable(refTable, conn);
    if (!refSchema) return NextResponse.json({ error: "Table not found" }, { status: 404 });

    const driver = getDriver(conn);
    const pk = refSchema.primaryKey;

    if (path.length === 1) {
      const [displayField] = path;
      const validCols = new Set(refSchema.columns.map((c) => c.name));
      if (!validCols.has(displayField)) {
        return NextResponse.json({ error: "Invalid field" }, { status: 400 });
      }
      const placeholders = ids.map((_, i) => driver.placeholder(i)).join(", ");
      const sql = `SELECT ${driver.quote(pk)}, ${driver.quote(displayField)} FROM ${driver.quote(refTable)} WHERE ${driver.quote(pk)} IN (${placeholders})`;
      const rows = await driver.query<Record<string, unknown>>(sql, ids);
      const result: Record<string, string> = {};
      for (const row of rows) {
        const key = String(row[pk]);
        const val = row[displayField];
        result[key] = val === null || val === undefined ? "" : String(val);
      }
      return NextResponse.json(result);
    }

    // 2-hop: path = [hopCol, displayField]
    const [hopCol, displayField] = path;
    const hopColDef = refSchema.columns.find((c) => c.name === hopCol);
    if (!hopColDef?.fk) {
      return NextResponse.json({ error: "First path segment is not a FK column" }, { status: 400 });
    }

    const hop2Table = hopColDef.fk.table;
    const hop2Pk = hopColDef.fk.column;
    const hop2Schema = await getTable(hop2Table, conn);
    if (!hop2Schema) return NextResponse.json({ error: "Hop-2 table not found" }, { status: 404 });
    if (!hop2Schema.columns.some((c) => c.name === displayField)) {
      return NextResponse.json({ error: "Invalid display field in hop-2 table" }, { status: 400 });
    }

    // Step 1: get hop1 FK values for the original IDs
    const placeholders1 = ids.map((_, i) => driver.placeholder(i)).join(", ");
    const sql1 = `SELECT ${driver.quote(pk)}, ${driver.quote(hopCol)} FROM ${driver.quote(refTable)} WHERE ${driver.quote(pk)} IN (${placeholders1})`;
    const rows1 = await driver.query<Record<string, unknown>>(sql1, ids);

    const origToHop: Record<string, string | null> = {};
    const hopIds = new Set<string>();
    for (const row of rows1) {
      const origId = String(row[pk]);
      const hopId = row[hopCol] != null ? String(row[hopCol]) : null;
      origToHop[origId] = hopId;
      if (hopId) hopIds.add(hopId);
    }

    if (hopIds.size === 0) return NextResponse.json({});

    // Step 2: resolve display values from hop2 table
    const hopIdsArr = [...hopIds];
    const placeholders2 = hopIdsArr.map((_, i) => driver.placeholder(i)).join(", ");
    const sql2 = `SELECT ${driver.quote(hop2Pk)}, ${driver.quote(displayField)} FROM ${driver.quote(hop2Table)} WHERE ${driver.quote(hop2Pk)} IN (${placeholders2})`;
    const rows2 = await driver.query<Record<string, unknown>>(sql2, hopIdsArr);

    const hopToDisplay: Record<string, string> = {};
    for (const row of rows2) {
      hopToDisplay[String(row[hop2Pk])] = row[displayField] != null ? String(row[displayField]) : "";
    }

    const result: Record<string, string> = {};
    for (const [origId, hopId] of Object.entries(origToHop)) {
      if (hopId != null) result[origId] = hopToDisplay[hopId] ?? "";
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
