import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getUserByUsername, logAudit } from "@/lib/internal-db";
import { signToken } from "@/lib/auth";
import { checkLoginAllowed, recordLoginFailure, recordLoginSuccess } from "@/lib/login-limiter";

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? null;

  try {
    const { username, password } = await req.json();

    if (!username || !password) {
      return NextResponse.json({ error: "Username and password required" }, { status: 400 });
    }

    const { blocked, retryAfterMs } = checkLoginAllowed(ip, username);
    if (blocked) {
      const retryAfterSec = Math.ceil(retryAfterMs / 1000);
      return NextResponse.json(
        { error: "Too many failed attempts. Try again later." },
        { status: 429, headers: { "Retry-After": String(retryAfterSec) } }
      );
    }

    const user = await getUserByUsername(username);
    if (!user) {
      recordLoginFailure(ip, username);
      logAudit({ username, action: "LOGIN_FAILED", ip }).catch(() => {});
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      recordLoginFailure(ip, username);
      logAudit({ userId: user.id, username: user.username, action: "LOGIN_FAILED", ip }).catch(() => {});
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    recordLoginSuccess(ip, username);
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
