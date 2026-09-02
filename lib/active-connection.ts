import type { NextRequest } from "next/server";
import type { DbConnection } from "./types";
import { getRequestUser } from "./request-auth";
import { resolveActiveConnection } from "./connection-access";

export async function getActiveConnection(req: NextRequest): Promise<DbConnection | null> {
  const user = await getRequestUser(req);
  const userId = user ? Number(user.sub) : NaN;
  return resolveActiveConnection(
    req.cookies.get("active_db_id")?.value,
    Number.isFinite(userId) ? userId : null
  );
}
