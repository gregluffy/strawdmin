import { NextRequest, NextResponse } from "next/server";
import { getViewSettings, upsertViewSettings } from "@/lib/internal-db";
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
    const settings = await getViewSettings(table, conn.id);
    return NextResponse.json(settings ?? null);
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
    const { table, visible_cols, sort_col, sort_dir } = await req.json();
    if (
      !table ||
      !Array.isArray(visible_cols) ||
      visible_cols.length === 0 ||
      !sort_col ||
      (sort_dir !== "asc" && sort_dir !== "desc")
    ) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    await upsertViewSettings(table, visible_cols as string[], sort_col as string, sort_dir as "asc" | "desc", conn.id);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
