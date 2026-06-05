import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { updateUser, deleteUser } from "@/lib/internal-db";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const { password, role } = await req.json();
    const updates: { password_hash?: string; role?: "admin" | "user" } = {};

    if (password) {
      if (password.length < 8) {
        return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
      }
      updates.password_hash = await bcrypt.hash(password, 12);
    }

    if (role && ["admin", "user"].includes(role)) {
      updates.role = role;
    }

    const ok = await updateUser(parseInt(id), updates);
    if (!ok) return NextResponse.json({ error: "User not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const ok = await deleteUser(parseInt(id));
    if (!ok) return NextResponse.json({ error: "User not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
