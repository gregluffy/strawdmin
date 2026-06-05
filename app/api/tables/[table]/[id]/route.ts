import { NextRequest, NextResponse } from "next/server";
import { getDriver } from "@/lib/drivers";
import { getTable } from "@/lib/introspect";
import { serializeRow, deserializeBinary } from "@/lib/sql";
import { getRequestUser } from "@/lib/request-auth";
import { getUserTablePolicy, getUserColumnPolicies } from "@/lib/internal-db";

type RouteParams = { params: Promise<{ table: string; id: string }> };

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { table, id } = await params;
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const schema = await getTable(table);
    if (!schema) return NextResponse.json({ error: "Table not found" }, { status: 404 });

    let hiddenCols = new Set<string>();
    if (user.role !== "admin") {
      const policy = await getUserTablePolicy(user.sub, table);
      if (!policy.can_view) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      const colPolicies = await getUserColumnPolicies(user.sub, table);
      hiddenCols = new Set(Object.entries(colPolicies).filter(([, p]) => p.hidden).map(([col]) => col));
    }

    const driver = getDriver();
    const rows = await driver.query(
      `SELECT * FROM ${driver.quote(table)} WHERE ${driver.quote(schema.primaryKey)} = ${driver.placeholder(0)}`,
      [id]
    );
    if (!rows[0]) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const row = serializeRow(rows[0] as Record<string, unknown>);
    for (const col of hiddenCols) delete row[col];
    return NextResponse.json(row);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const { table, id } = await params;
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const schema = await getTable(table);
    if (!schema) return NextResponse.json({ error: "Table not found" }, { status: 404 });

    let readOnlyCols = new Set<string>();
    if (user.role !== "admin") {
      const policy = await getUserTablePolicy(user.sub, table);
      if (!policy.can_update) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      const colPolicies = await getUserColumnPolicies(user.sub, table);
      readOnlyCols = new Set(Object.entries(colPolicies).filter(([, p]) => p.read_only).map(([col]) => col));
    }

    const body = await req.json();
    const driver = getDriver();

    const updateCols = schema.columns.filter(
      (c) => !c.isPrimary && body[c.name] !== undefined && !readOnlyCols.has(c.name)
    );
    if (updateCols.length === 0) {
      return NextResponse.json({ error: "No editable fields to update" }, { status: 400 });
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

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const { table, id } = await params;
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const schema = await getTable(table);
    if (!schema) return NextResponse.json({ error: "Table not found" }, { status: 404 });

    if (user.role !== "admin") {
      const policy = await getUserTablePolicy(user.sub, table);
      if (!policy.can_delete) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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
