import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const BASE_PATH = process.env.BASE_PATH ?? "";
const PUBLIC_PREFIXES = ["/login", "/setup", "/api/auth/login", "/api/setup"];
const STATIC_EXT = /\.\w+$/;

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET ?? "default-dev-secret-change-in-production";
  return new TextEncoder().encode(secret);
}

function redirectTo(req: NextRequest, path: string): NextResponse {
  const url = new URL(`${BASE_PATH}${path}`, req.url);
  return NextResponse.redirect(url);
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    pathname === "/" ||
    PUBLIC_PREFIXES.some((p) => pathname.startsWith(p)) ||
    STATIC_EXT.test(pathname)
  ) {
    return NextResponse.next();
  }

  const token = req.cookies.get("auth_token")?.value;

  if (!token) {
    return redirectTo(req, "/login");
  }

  try {
    const { payload } = await jwtVerify(token, getSecret());
    const role = payload.role as string;

    const adminOnlyPaths = ["/dashboard/users", "/dashboard/backups", "/api/users", "/api/backups"];
    const isAdminOnly = adminOnlyPaths.some((p) => pathname.startsWith(p));

    if (isAdminOnly && role !== "admin") {
      if (pathname.startsWith("/api/")) {
        return new NextResponse(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      }
      return redirectTo(req, "/dashboard");
    }

    return NextResponse.next();
  } catch {
    const response = redirectTo(req, "/login");
    response.cookies.delete("auth_token");
    return response;
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public).*)"],
};
