import { SignJWT, jwtVerify } from "jose";
import type { JwtPayload } from "./types";

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET ?? "default-dev-secret-change-in-production";
  return new TextEncoder().encode(secret);
}

export async function signToken(payload: Omit<JwtPayload, "iat" | "exp">): Promise<string> {
  return new SignJWT({ ...payload, sub: String(payload.sub) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecret());
}

export async function verifyToken(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, getSecret());
  return payload as unknown as JwtPayload;
}
