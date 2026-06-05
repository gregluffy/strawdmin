import { NextRequest, NextResponse } from "next/server";
import { getRequestUser } from "@/lib/request-auth";
import {
  getUsers,
  getTablePoliciesForTable,
  getColumnPoliciesForTable,
  upsertTablePolicy,
  upsertColumnPolicy,
} from "@/lib/internal-db";

export async function GET(req: NextRequest) {
  const user = await getRequestUser(req);
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const table = req.nextUrl.searchParams.get("table");
  if (!table) return NextResponse.json({ error: "Missing table" }, { status: 400 });

  try {
    const [allUsers, tablePolicyRows, columnPolicyRows] = await Promise.all([
      getUsers(),
      getTablePoliciesForTable(table),
      getColumnPoliciesForTable(table),
    ]);

    const nonAdminUsers = allUsers.filter((u) => u.role !== "admin");

    // Build a map: userId → explicit table policy row
    const tpMap = new Map(tablePolicyRows.map((r) => [r.user_id, r]));

    // Build a map: userId → column → policy
    const cpMap = new Map<number, Record<string, { hidden: boolean; read_only: boolean }>>();
    for (const r of columnPolicyRows) {
      if (!cpMap.has(r.user_id)) cpMap.set(r.user_id, {});
      cpMap.get(r.user_id)![r.column_name] = { hidden: r.hidden, read_only: r.read_only };
    }

    const users = nonAdminUsers.map((u) => {
      const tp = tpMap.get(u.id) ?? { can_view: true, can_insert: true, can_update: true, can_delete: true };
      return {
        id: u.id,
        username: u.username,
        table: {
          can_view: tp.can_view,
          can_insert: tp.can_insert,
          can_update: tp.can_update,
          can_delete: tp.can_delete,
        },
        columns: cpMap.get(u.id) ?? {},
      };
    });

    return NextResponse.json({ users });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const user = await getRequestUser(req);
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const body = await req.json();

    if (body.type === "table") {
      const { userId, table, can_view, can_insert, can_update, can_delete } = body;
      if (!userId || !table) return NextResponse.json({ error: "Missing userId or table" }, { status: 400 });
      await upsertTablePolicy(Number(userId), table, {
        can_view: Boolean(can_view),
        can_insert: Boolean(can_insert),
        can_update: Boolean(can_update),
        can_delete: Boolean(can_delete),
      });
    } else if (body.type === "column") {
      const { userId, table, column, hidden, read_only } = body;
      if (!userId || !table || !column) return NextResponse.json({ error: "Missing userId, table, or column" }, { status: 400 });
      await upsertColumnPolicy(Number(userId), table, column, {
        hidden: Boolean(hidden),
        read_only: Boolean(read_only),
      });
    } else {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
