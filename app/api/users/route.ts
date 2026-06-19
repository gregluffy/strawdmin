import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getUsers, createUser } from "@/lib/internal-db";
import { getRequestUser } from "@/lib/request-auth";

export async function GET(req: NextRequest) {
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const users = await getUsers();
    return NextResponse.json(users);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const { username, password, role } = await req.json();
    if (!username || !password || !["admin", "user"].includes(role)) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }
    const hash = await bcrypt.hash(password, 12);
    const created = await createUser(username, hash, role);
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("UNIQUE") || msg.includes("unique") || msg.includes("Duplicate")) {
      return NextResponse.json({ error: "Username already taken" }, { status: 409 });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
