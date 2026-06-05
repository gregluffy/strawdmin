import type { NextRequest } from "next/server";
import { verifyToken } from "./auth";
import type { JwtPayload } from "./types";

export async function getRequestUser(req: NextRequest): Promise<JwtPayload | null> {
  try {
    const token = req.cookies.get("auth_token")?.value;
    if (!token) return null;
    return await verifyToken(token);
  } catch {
    return null;
  }
}
