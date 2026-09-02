import { NextRequest, NextResponse } from "next/server";
import { getRequestUser } from "@/lib/request-auth";
import { getUserById, getUserDbAccess, setUserDbAccess, listDbConnections } from "@/lib/internal-db";
import type { DbAccessMode } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const userId = parseInt((await params).id);
  if (isNaN(userId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    if (!(await getUserById(userId))) return NextResponse.json({ error: "User not found" }, { status: 404 });
    const access = await getUserDbAccess(userId);
    const connections = await listDbConnections();
    return NextResponse.json({
      mode: access.mode,
      conn_ids: access.conn_ids,
      connections: connections.map((c) => ({ id: c.id, name: c.name, db_type: c.db_type })),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const userId = parseInt((await params).id);
  if (isNaN(userId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    const { mode, conn_ids } = await req.json();
    if (mode !== "all" && mode !== "restricted") {
      return NextResponse.json({ error: "mode must be 'all' or 'restricted'" }, { status: 400 });
    }
    if (mode === "restricted" && !Array.isArray(conn_ids)) {
      return NextResponse.json({ error: "conn_ids must be an array" }, { status: 400 });
    }

    // Drop ids that don't refer to a real connection so stale selections can't linger
    const existing = new Set((await listDbConnections()).map((c) => c.id));
    const ids: number[] = mode === "restricted"
      ? (conn_ids as unknown[]).map(Number).filter((n) => Number.isFinite(n) && existing.has(n))
      : [];

    const ok = await setUserDbAccess(userId, mode as DbAccessMode, ids);
    if (!ok) return NextResponse.json({ error: "User not found" }, { status: 404 });
    return NextResponse.json({ ok: true, mode, conn_ids: ids });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
