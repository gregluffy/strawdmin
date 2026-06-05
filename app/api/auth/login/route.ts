import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getUserByUsername, logAudit } from "@/lib/internal-db";
import { signToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? null;

  try {
    const { username, password } = await req.json();

    if (!username || !password) {
      return NextResponse.json({ error: "Username and password required" }, { status: 400 });
    }

    const user = await getUserByUsername(username);
    if (!user) {
      logAudit({ username, action: "LOGIN_FAILED", ip }).catch(() => {});
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      logAudit({ userId: user.id, username: user.username, action: "LOGIN_FAILED", ip }).catch(() => {});
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const token = await signToken({ sub: user.id, username: user.username, role: user.role });
    logAudit({ userId: user.id, username: user.username, action: "LOGIN", ip }).catch(() => {});

    const response = NextResponse.json({ user: { id: user.id, username: user.username, role: user.role } });
    response.cookies.set("auth_token", token, {
      httpOnly: true,
      secure: process.env.SECURE_COOKIES !== "false" && process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    });
    return response;
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
