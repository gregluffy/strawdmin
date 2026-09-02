import { cookies } from "next/headers";
import type { DbConnection } from "./types";
import { verifyToken } from "./auth";
import { resolveActiveConnection } from "./connection-access";

export async function getServerActiveConnection(): Promise<DbConnection | null> {
  const cookieStore = await cookies();

  let userId: number | null = null;
  const token = cookieStore.get("auth_token")?.value;
  if (token) {
    try {
      const n = Number((await verifyToken(token)).sub);
      if (Number.isFinite(n)) userId = n;
    } catch {
      // unauthenticated — resolve unrestricted; the page itself still gates access
    }
  }

  return resolveActiveConnection(cookieStore.get("active_db_id")?.value, userId);
}
