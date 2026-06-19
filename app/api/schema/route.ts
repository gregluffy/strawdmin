import { NextRequest, NextResponse } from "next/server";
import { introspect, clearSchemaCache } from "@/lib/introspect";
import { getRequestUser } from "@/lib/request-auth";
import { getUserTablePolicy } from "@/lib/internal-db";
import { getActiveConnection } from "@/lib/active-connection";

export async function GET(req: NextRequest) {
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conn = await getActiveConnection(req);
  if (!conn) return NextResponse.json({ error: "No active database connection" }, { status: 400 });

  try {
    const schema = await introspect(conn);

    if (user.role === "admin") return NextResponse.json(schema);

    const visibleTables = await Promise.all(
      schema.tables.map(async (t) => {
        const policy = await getUserTablePolicy(user.sub, t.name, conn.id);
        return policy.can_view ? t : null;
      })
    );

    return NextResponse.json({
      ...schema,
      tables: visibleTables.filter(Boolean),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to introspect schema" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const conn = await getActiveConnection(req);
  if (conn) clearSchemaCache(conn.id);
  else clearSchemaCache();
  return NextResponse.json({ ok: true });
}
