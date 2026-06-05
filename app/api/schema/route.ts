import { NextResponse } from "next/server";
import { introspect, clearSchemaCache } from "@/lib/introspect";

export async function GET() {
  try {
    const schema = await introspect();
    return NextResponse.json(schema);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Failed to introspect schema" }, { status: 500 });
  }
}

export async function DELETE() {
  clearSchemaCache();
  return NextResponse.json({ ok: true });
}
