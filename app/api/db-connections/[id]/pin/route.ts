import { NextRequest, NextResponse } from "next/server";
import { getRequestUser } from "@/lib/request-auth";
import { getDbConnection, setPinnedDbConnection } from "@/lib/internal-db";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: RouteParams) {
  const user = await getRequestUser(req);
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const connId = parseInt(id);
  if (isNaN(connId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    const conn = await getDbConnection(connId);
    if (!conn) return NextResponse.json({ error: "Connection not found" }, { status: 404 });

    // Toggle: if already pinned, unpin (pass null); otherwise pin this one
    const newPinnedId = conn.is_pinned ? null : connId;
    await setPinnedDbConnection(newPinnedId);
    return NextResponse.json({ ok: true, is_pinned: newPinnedId !== null });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
