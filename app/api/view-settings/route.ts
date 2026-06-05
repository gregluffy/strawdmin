import { NextRequest, NextResponse } from "next/server";
import { getViewSettings, upsertViewSettings } from "@/lib/internal-db";

export async function GET(req: NextRequest) {
  const table = req.nextUrl.searchParams.get("table");
  if (!table) return NextResponse.json({ error: "Missing table" }, { status: 400 });
  try {
    const settings = await getViewSettings(table);
    return NextResponse.json(settings ?? null);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
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
    await upsertViewSettings(table, visible_cols as string[], sort_col as string, sort_dir as "asc" | "desc");
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
