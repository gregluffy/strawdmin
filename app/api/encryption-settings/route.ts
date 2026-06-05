import { NextRequest, NextResponse } from "next/server";
import { getEncryptionSettings, upsertEncryptionSetting, deleteEncryptionSetting } from "@/lib/internal-db";

export async function GET(req: NextRequest) {
  const table = req.nextUrl.searchParams.get("table");
  if (!table) return NextResponse.json({ error: "Missing table" }, { status: 400 });
  try {
    const settings = await getEncryptionSettings(table);
    return NextResponse.json(settings);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { table, column, algorithm, saltColumn } = await req.json();
    if (!table || !column || !algorithm) {
      return NextResponse.json({ error: "Missing table, column, or algorithm" }, { status: 400 });
    }
    if (algorithm !== "SHA512" && algorithm !== "SHA256") {
      return NextResponse.json({ error: "algorithm must be SHA512 or SHA256" }, { status: 400 });
    }
    await upsertEncryptionSetting(table, column, algorithm, saltColumn ?? undefined);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { table, column } = await req.json();
    if (!table || !column) {
      return NextResponse.json({ error: "Missing table or column" }, { status: 400 });
    }
    await deleteEncryptionSetting(table, column);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
