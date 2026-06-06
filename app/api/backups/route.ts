import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { introspect } from "@/lib/introspect";
import { getDriver } from "@/lib/drivers";
import { serializeRow } from "@/lib/sql";
import type { BackupMeta } from "@/lib/types";

function getBackupDir(): string {
  const base = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
  const dir = path.join(base, "backups");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export async function GET() {
  try {
    const dir = getBackupDir();
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    const backups: BackupMeta[] = files.map((f) => {
      const stat = fs.statSync(path.join(dir, f));
      return { name: f, size: stat.size, createdAt: stat.birthtime.toISOString() };
    });
    backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return NextResponse.json(backups);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

const BACKUP_ROW_LIMIT = 100_000;

export async function POST() {
  try {
    const schema = await introspect();
    const driver = getDriver();

    // Pre-flight: count total rows across all tables to avoid loading a huge
    // database into memory. COUNT(*) is valid in all supported dialects.
    let totalRows = 0;
    for (const table of schema.tables) {
      try {
        const result = await driver.query(`SELECT COUNT(*) as c FROM ${driver.quote(table.name)}`);
        totalRows += Number(result[0]?.c ?? 0);
      } catch {
        // inaccessible table — will also be skipped during export
      }
    }
    if (totalRows > BACKUP_ROW_LIMIT) {
      return NextResponse.json(
        {
          error:
            `This database has ${totalRows.toLocaleString()} rows across all tables. ` +
            `The built-in backup is limited to ${BACKUP_ROW_LIMIT.toLocaleString()} rows. ` +
            `Use your database's native export tool (pg_dump, mysqldump, etc.) for large databases.`,
        },
        { status: 413 }
      );
    }

    const tables: Record<string, Record<string, unknown>[]> = {};
    const skipped: string[] = [];
    for (const table of schema.tables) {
      try {
        const rows = await driver.query(`SELECT * FROM ${driver.quote(table.name)}`);
        tables[table.name] = (rows as Record<string, unknown>[]).map(serializeRow);
      } catch {
        skipped.push(table.name);
      }
    }

    const backup = { created_at: new Date().toISOString(), db_type: driver.dbType, tables };
    const name = `backup_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    const dir = getBackupDir();
    fs.writeFileSync(path.join(dir, name), JSON.stringify(backup, null, 2));

    return NextResponse.json(
      { ok: true, name, ...(skipped.length > 0 && { skipped }) },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
