import { NextRequest, NextResponse } from "next/server";
import { getFkSettings, upsertFkSetting } from "@/lib/internal-db";
import { getActiveConnection } from "@/lib/active-connection";
import { getRequestUser } from "@/lib/request-auth";

export async function GET(req: NextRequest) {
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const table = req.nextUrl.searchParams.get("table");
  if (!table) return NextResponse.json({ error: "Missing table" }, { status: 400 });

  const conn = await getActiveConnection(req);
  if (!conn) return NextResponse.json({ error: "No active database connection" }, { status: 400 });

  try {
    const settings = await getFkSettings(table, conn.id);
    return NextResponse.json(settings);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conn = await getActiveConnection(req);
  if (!conn) return NextResponse.json({ error: "No active database connection" }, { status: 400 });

  try {
    const { table, column, displayField } = await req.json();
    if (!table || !column || !displayField) {
      return NextResponse.json({ error: "Missing table, column, or displayField" }, { status: 400 });
    }
    await upsertFkSetting(table, column, displayField, conn.id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
