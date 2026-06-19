import { NextRequest, NextResponse } from "next/server";
import { getRequestUser } from "@/lib/request-auth";
import { createTempDriver, createTempDriverWithSsh } from "@/lib/drivers";
import { getDbConnection } from "@/lib/internal-db";

export async function POST(req: NextRequest) {
  const user = await getRequestUser(req);
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json();
    const { db_type, connection_string, ssh, conn_id } = body;
    if (!db_type || !connection_string) {
      return NextResponse.json({ error: "Missing db_type or connection_string" }, { status: 400 });
    }

    // When editing an existing connection, fetch stored credentials for fields left blank
    const stored = conn_id ? await getDbConnection(Number(conn_id)) : null;

    if (ssh?.enabled) {
      if (!ssh.host || !ssh.user) {
        return NextResponse.json({ ok: false, error: "SSH host and user are required" }, { status: 200 });
      }
      const { driver, closeTunnel } = await createTempDriverWithSsh(db_type, connection_string, {
        host: ssh.host,
        port: ssh.port ? Number(ssh.port) : 22,
        user: ssh.user,
        auth_type: ssh.auth_type ?? "password",
        password: ssh.password ?? stored?.ssh_password,
        private_key: ssh.private_key ?? stored?.ssh_private_key,
        passphrase: ssh.passphrase ?? stored?.ssh_passphrase,
      });
      try {
        await driver.query("SELECT 1 AS ok");
        return NextResponse.json({ ok: true });
      } finally {
        await driver.close();
        closeTunnel();
      }
    }

    const driver = createTempDriver(db_type, connection_string);
    try {
      await driver.query("SELECT 1 AS ok");
      return NextResponse.json({ ok: true });
    } finally {
      await driver.close();
    }
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 200 });
  }
}
