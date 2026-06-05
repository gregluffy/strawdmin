import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { isFirstRun, createUser } from "@/lib/internal-db";
import { signToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const firstRun = await isFirstRun();
    if (!firstRun) {
      return NextResponse.json({ error: "Setup already complete" }, { status: 403 });
    }

    const { username, password } = await req.json();
    if (!username || !password || password.length < 8) {
      return NextResponse.json(
        { error: "Username required and password must be at least 8 characters" },
        { status: 400 }
      );
    }

    const hash = await bcrypt.hash(password, 12);
    const user = await createUser(username, hash, "admin");
    const token = await signToken({ sub: user.id, username: user.username, role: user.role });

    const response = NextResponse.json({ ok: true });
    response.cookies.set("auth_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
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
