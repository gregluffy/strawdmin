import { NextRequest, NextResponse } from "next/server";
import { getRequestUser } from "@/lib/request-auth";
import { createTempDriver, createTempDriverWithSsh } from "@/lib/drivers";

export async function POST(req: NextRequest) {
  const user = await getRequestUser(req);
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json();
    const { db_type, connection_string, ssh } = body;
    if (!db_type || !connection_string) {
      return NextResponse.json({ error: "Missing db_type or connection_string" }, { status: 400 });
    }

    if (ssh?.enabled) {
      if (!ssh.host || !ssh.user) {
        return NextResponse.json({ ok: false, error: "SSH host and user are required" }, { status: 200 });
      }
      const { driver, closeTunnel } = await createTempDriverWithSsh(db_type, connection_string, {
        host: ssh.host,
        port: ssh.port ? Number(ssh.port) : 22,
        user: ssh.user,
        auth_type: ssh.auth_type ?? "password",
        password: ssh.password,
        private_key: ssh.private_key,
        passphrase: ssh.passphrase,
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
