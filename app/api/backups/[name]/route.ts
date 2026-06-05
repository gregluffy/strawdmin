import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

function getBackupPath(name: string): string {
  const base = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
  return path.join(base, "backups", name);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  try {
    if (!name.endsWith(".json") || name.includes("/") || name.includes("..")) {
      return NextResponse.json({ error: "Invalid backup name" }, { status: 400 });
    }
    const filePath = getBackupPath(name);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "Backup not found" }, { status: 404 });
    }
    fs.unlinkSync(filePath);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
