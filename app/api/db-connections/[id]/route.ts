import { NextRequest, NextResponse } from "next/server";
import { getRequestUser } from "@/lib/request-auth";
import { updateDbConnection, deleteDbConnection } from "@/lib/internal-db";
import { closeDriver } from "@/lib/drivers";
import { clearSchemaCache } from "@/lib/introspect";
import type { DbType } from "@/lib/types";

type RouteParams = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const user = await getRequestUser(req);
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const connId = parseInt(id);
  if (isNaN(connId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    const { name, db_type, connection_string } = await req.json();
    const updates: Parameters<typeof updateDbConnection>[1] = {};
    if (name !== undefined) updates.name = String(name).trim();
    if (db_type !== undefined) {
      const validTypes: DbType[] = ["postgres", "mysql", "mariadb", "mssql", "sqlite"];
      if (!validTypes.includes(db_type)) return NextResponse.json({ error: "Invalid db_type" }, { status: 400 });
      updates.db_type = db_type as DbType;
    }
    if (connection_string !== undefined) updates.connection_string = String(connection_string).trim();

    const ok = await updateDbConnection(connId, updates);
    if (!ok) return NextResponse.json({ error: "Connection not found or nothing to update" }, { status: 404 });

    // Close cached driver and schema so they're recreated with new config
    await closeDriver(connId);
    clearSchemaCache(connId);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const user = await getRequestUser(req);
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const connId = parseInt(id);
  if (isNaN(connId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    const ok = await deleteDbConnection(connId);
    if (!ok) return NextResponse.json({ error: "Connection not found" }, { status: 404 });

    await closeDriver(connId);
    clearSchemaCache(connId);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
