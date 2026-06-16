import { NextRequest, NextResponse } from "next/server";
import { getRequestUser } from "@/lib/request-auth";
import { createTempDriver } from "@/lib/drivers";

export async function POST(req: NextRequest) {
  const user = await getRequestUser(req);
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { db_type, connection_string } = await req.json();
    if (!db_type || !connection_string) {
      return NextResponse.json({ error: "Missing db_type or connection_string" }, { status: 400 });
    }

    const driver = createTempDriver(db_type, connection_string);
    try {
      // Run a minimal query to verify connectivity
      if (db_type === "postgres") {
        await driver.query("SELECT 1 AS ok");
      } else if (db_type === "mysql" || db_type === "mariadb") {
        await driver.query("SELECT 1 AS ok");
      } else if (db_type === "mssql") {
        await driver.query("SELECT 1 AS ok");
      } else if (db_type === "sqlite") {
        await driver.query("SELECT 1 AS ok");
      }
      return NextResponse.json({ ok: true });
    } finally {
      await driver.close();
    }
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 200 });
  }
}
