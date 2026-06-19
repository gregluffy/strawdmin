import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getRequestUser } from "@/lib/request-auth";

function getBackupDir(): string {
  const base = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
  return path.resolve(path.join(base, "backups"));
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { name } = await params;
  try {
    if (!name.endsWith(".json")) {
      return NextResponse.json({ error: "Invalid backup name" }, { status: 400 });
    }
    const backupDir = getBackupDir();
    const filePath = path.resolve(path.join(backupDir, name));
    if (!filePath.startsWith(backupDir + path.sep)) {
      return NextResponse.json({ error: "Invalid backup name" }, { status: 400 });
    }
    if (!fs.existsSync(filePath)) {
      return NextResponse.json({ error: "Backup not found" }, { status: 404 });
    }
    fs.unlinkSync(filePath);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
