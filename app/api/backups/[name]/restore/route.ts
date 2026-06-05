import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getDriver } from "@/lib/drivers";
import { introspect } from "@/lib/introspect";
import type { BackupFile, Column, SchemaTable } from "@/lib/types";
import { deserializeBinary } from "@/lib/sql";

function getBackupPath(name: string): string {
  const base = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
  return path.join(base, "backups", name);
}

function topologicalSort(tables: SchemaTable[]): SchemaTable[] {
  const deps = new Map<string, Set<string>>();
  for (const t of tables) {
    deps.set(t.name, new Set(
      t.columns.filter((c) => c.fk).map((c) => c.fk!.table).filter((r) => r !== t.name)
    ));
  }
  const sorted: SchemaTable[] = [];
  const visited = new Set<string>();
  function visit(name: string) {
    if (visited.has(name)) return;
    visited.add(name);
    for (const dep of deps.get(name) ?? []) visit(dep);
    const t = tables.find((x) => x.name === name);
    if (t) sorted.push(t);
  }
  for (const t of tables) visit(t.name);
  return sorted;
}

const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function fallbackForNotNull(col: Column): unknown {
  const t = col.type.toLowerCase();
  if (t.includes("timestamp") || t.includes("datetime") || t.includes("date") || t.includes("time")) {
    return new Date().toISOString();
  }
  if (t.includes("int") || t.includes("float") || t.includes("numeric") || t.includes("decimal") || t.includes("real") || t.includes("double")) {
    return 0;
  }
  if (t.includes("bool")) {
    return false;
  }
  return "";
}

function normalizeValue(v: unknown, isJson: boolean, dbType: string): unknown {
  if (isJson && typeof v === "object") return JSON.stringify(v);
  if (
    typeof v === "string" &&
    ISO_DATETIME_RE.test(v) &&
    (dbType === "mysql" || dbType === "mariadb")
  ) {
    return v.replace("T", " ").replace("Z", "");
  }
  return v;
}

export async function POST(
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

    const backup: BackupFile = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const schema = await introspect();
    const driver = getDriver();

    const sortedTables = topologicalSort(schema.tables);
    const backupTables = sortedTables.filter((t) => backup.tables[t.name]);

    // Disable FK constraints for the duration of the restore
    if (driver.dbType === "mssql") {
      for (const t of backupTables) {
        await driver.query(`ALTER TABLE ${driver.quote(t.name)} NOCHECK CONSTRAINT ALL`);
      }
    } else if (driver.dbType === "mysql" || driver.dbType === "mariadb") {
      await driver.query("SET FOREIGN_KEY_CHECKS = 0");
    } else if (driver.dbType === "sqlite") {
      await driver.query("PRAGMA foreign_keys = OFF");
    }

    try {
      for (const t of [...backupTables].reverse()) {
        if (driver.dbType === "postgres") {
          await driver.query(`TRUNCATE TABLE ${driver.quote(t.name)} RESTART IDENTITY CASCADE`);
        } else {
          await driver.query(`DELETE FROM ${driver.quote(t.name)}`);
        }
      }

      for (const t of backupTables) {
        const rows = backup.tables[t.name];
        if (!rows || rows.length === 0) continue;
        const schemaColMap = new Map(t.columns.map((c) => [c.name, c]));
        const needsIdentityInsert = driver.dbType === "mssql" && t.columns.some((c) => c.isAutoIncrement);
        for (const row of rows) {
          const entries: { name: string; value: unknown }[] = [];
          for (const [colName, rawValue] of Object.entries(row)) {
            const colSchema = schemaColMap.get(colName);
            if (rawValue === null || rawValue === undefined) {
              if (colSchema && !colSchema.nullable) {
                if (colSchema.defaultValue) continue;
                entries.push({ name: colName, value: fallbackForNotNull(colSchema) });
              } else {
                entries.push({ name: colName, value: null });
              }
            } else {
              entries.push({ name: colName, value: normalizeValue(deserializeBinary(rawValue, colSchema?.type ?? ""), !!colSchema?.isJson, driver.dbType) });
            }
          }
          if (entries.length === 0) continue;
          const quotedCols = entries.map((e) => driver.quote(e.name)).join(", ");
          const values = entries.map((e) => e.value);
          const phs = entries.map((_, i) => driver.placeholder(i)).join(", ");
          let sql = `INSERT INTO ${driver.quote(t.name)} (${quotedCols}) VALUES (${phs})`;
          if (needsIdentityInsert) {
            sql = `SET IDENTITY_INSERT ${driver.quote(t.name)} ON\n${sql}\nSET IDENTITY_INSERT ${driver.quote(t.name)} OFF`;
          }
          await driver.query(sql, values);
        }
      }
    } finally {
      // Always re-enable FK constraints
      if (driver.dbType === "mssql") {
        for (const t of backupTables) {
          await driver.query(`ALTER TABLE ${driver.quote(t.name)} WITH NOCHECK CHECK CONSTRAINT ALL`);
        }
      } else if (driver.dbType === "mysql" || driver.dbType === "mariadb") {
        await driver.query("SET FOREIGN_KEY_CHECKS = 1");
      } else if (driver.dbType === "sqlite") {
        await driver.query("PRAGMA foreign_keys = ON");
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
