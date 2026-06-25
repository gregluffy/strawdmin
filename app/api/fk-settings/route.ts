import { NextRequest, NextResponse } from "next/server";
import { getFkSettings, upsertFkSetting, deleteFkSetting } from "@/lib/internal-db";
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

export async function DELETE(req: NextRequest) {
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conn = await getActiveConnection(req);
  if (!conn) return NextResponse.json({ error: "No active database connection" }, { status: 400 });

  const table = req.nextUrl.searchParams.get("table");
  const column = req.nextUrl.searchParams.get("column");
  if (!table || !column) return NextResponse.json({ error: "Missing table or column" }, { status: 400 });

  try {
    await deleteFkSetting(table, column, conn.id);
    return new NextResponse(null, { status: 204 });
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
    const { table, column, displayPath } = await req.json();
    if (!table || !column || !Array.isArray(displayPath) || displayPath.length === 0 || displayPath.length > 2) {
      return NextResponse.json({ error: "Missing or invalid table, column, or displayPath" }, { status: 400 });
    }
    await upsertFkSetting(table, column, displayPath, conn.id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
