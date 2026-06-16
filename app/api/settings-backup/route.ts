import { NextRequest, NextResponse } from "next/server";
import { getRequestUser } from "@/lib/request-auth";
import { exportAllSettings, restoreAllSettings } from "@/lib/internal-db";
import { getActiveConnection } from "@/lib/active-connection";

export async function GET(req: NextRequest) {
  const user = await getRequestUser(req);
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const conn = await getActiveConnection(req);
  if (!conn) return NextResponse.json({ error: "No active database connection" }, { status: 400 });

  try {
    const data = await exportAllSettings(conn.id);
    const payload = {
      version: 1,
      created_at: new Date().toISOString(),
      db_fingerprint: `conn:${conn.id}`,
      ...data,
    };
    const json = JSON.stringify(payload, null, 2);
    const filename = `strawdmin-settings-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    return new NextResponse(json, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const user = await getRequestUser(req);
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const conn = await getActiveConnection(req);
  if (!conn) return NextResponse.json({ error: "No active database connection" }, { status: 400 });

  try {
    const backup = await req.json();
    if (!backup || typeof backup !== "object" || backup.version !== 1) {
      return NextResponse.json({ error: "Invalid backup file format" }, { status: 400 });
    }
    const result = await restoreAllSettings(backup, conn.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
