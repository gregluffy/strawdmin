import { NextRequest, NextResponse } from "next/server";
import { getRequestUser } from "@/lib/request-auth";
import { getDbConnection } from "@/lib/internal-db";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: RouteParams) {
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const connId = parseInt(id);
  if (isNaN(connId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    const conn = await getDbConnection(connId);
    if (!conn) return NextResponse.json({ error: "Connection not found" }, { status: 404 });

    const isSecure = process.env.SECURE_COOKIES !== "false";
    const response = NextResponse.json({ ok: true, id: conn.id, name: conn.name });
    response.cookies.set("active_db_id", String(conn.id), {
      httpOnly: false,
      secure: isSecure,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    return response;
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
