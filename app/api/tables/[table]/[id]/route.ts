import { NextRequest, NextResponse } from "next/server";
import { getDriver } from "@/lib/drivers";
import { getTable } from "@/lib/introspect";
import { serializeRow, deserializeBinary } from "@/lib/sql";

type RouteParams = { params: Promise<{ table: string; id: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { table, id } = await params;
  try {
    const schema = await getTable(table);
    if (!schema) return NextResponse.json({ error: "Table not found" }, { status: 404 });

    const driver = getDriver();
    const rows = await driver.query(
      `SELECT * FROM ${driver.quote(table)} WHERE ${driver.quote(schema.primaryKey)} = ${driver.placeholder(0)}`,
      [id]
    );
    if (!rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(serializeRow(rows[0] as Record<string, unknown>));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const { table, id } = await params;
  try {
    const schema = await getTable(table);
    if (!schema) return NextResponse.json({ error: "Table not found" }, { status: 404 });

    const body = await req.json();
    const driver = getDriver();

    const updateCols = schema.columns.filter(
      (c) => !c.isPrimary && body[c.name] !== undefined
    );
    if (updateCols.length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const values: unknown[] = updateCols.map((c) => {
      const v = body[c.name];
      if (c.isJson && typeof v === "object") return JSON.stringify(v);
      return deserializeBinary(v, c.type);
    });
    values.push(id);

    const setParts = updateCols.map((c, i) => `${driver.quote(c.name)} = ${driver.placeholder(i)}`);
    const sql = `UPDATE ${driver.quote(table)} SET ${setParts.join(", ")} WHERE ${driver.quote(schema.primaryKey)} = ${driver.placeholder(updateCols.length)}`;

    await driver.query(sql, values);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const { table, id } = await params;
  try {
    const schema = await getTable(table);
    if (!schema) return NextResponse.json({ error: "Table not found" }, { status: 404 });

    const driver = getDriver();
    await driver.query(
      `DELETE FROM ${driver.quote(table)} WHERE ${driver.quote(schema.primaryKey)} = ${driver.placeholder(0)}`,
      [id]
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
