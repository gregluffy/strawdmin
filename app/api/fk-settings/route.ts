import { NextRequest, NextResponse } from "next/server";
import { getFkSettings, upsertFkSetting } from "@/lib/internal-db";
import { getActiveConnection } from "@/lib/active-connection";

export async function GET(req: NextRequest) {
  const table = req.nextUrl.searchParams.get("table");
  if (!table) return NextResponse.json({ error: "Missing table" }, { status: 400 });

  const conn = await getActiveConnection(req);
  if (!conn) return NextResponse.json({ error: "No active database connection" }, { status: 400 });

  try {
    const settings = await getFkSettings(table, conn.id);
    return NextResponse.json(settings);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
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
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
