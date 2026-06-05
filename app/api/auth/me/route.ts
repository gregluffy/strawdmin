import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const token = req.cookies.get("auth_token")?.value;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const payload = await verifyToken(token);
    return NextResponse.json({ id: payload.sub, username: payload.username, role: payload.role });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
