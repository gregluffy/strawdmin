import { NextRequest, NextResponse } from "next/server";
import { hashSHA512, hashSHA512Standard, hashSHA256 } from "@/lib/crypto";
import { getRequestUser } from "@/lib/request-auth";

export async function POST(req: NextRequest) {
  const user = await getRequestUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { algorithm, value, salt } = await req.json();
    if (!algorithm || typeof value !== "string") {
      return NextResponse.json({ error: "Missing algorithm or value" }, { status: 400 });
    }
    if (algorithm !== "SHA512" && algorithm !== "SHA512_STD" && algorithm !== "SHA256") {
      return NextResponse.json({ error: "algorithm must be SHA512, SHA512_STD, or SHA256" }, { status: 400 });
    }
    const s = typeof salt === "string" ? salt : "";
    const hash = algorithm === "SHA512" ? hashSHA512(value, s) : algorithm === "SHA512_STD" ? hashSHA512Standard(value, s) : hashSHA256(value, s);
    return NextResponse.json({ hash });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
