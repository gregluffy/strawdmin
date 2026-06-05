import { NextRequest, NextResponse } from "next/server";
import { introspect, clearSchemaCache } from "@/lib/introspect";
import { getRequestUser } from "@/lib/request-auth";
import { getUserTablePolicy } from "@/lib/internal-db";

export async function GET(req: NextRequest) {
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const schema = await introspect();

    if (user.role === "admin") return NextResponse.json(schema);

    // Filter out tables the user cannot view
    const visibleTables = await Promise.all(
      schema.tables.map(async (t) => {
        const policy = await getUserTablePolicy(user.sub, t.name);
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

export async function DELETE() {
  clearSchemaCache();
  return NextResponse.json({ ok: true });
}
