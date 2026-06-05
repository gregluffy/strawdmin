import { createHash, randomBytes } from "crypto";

// SHA512: base64(hex(sha512(value + salt))) — matches C# DoHash implementation
export function hashSHA512(value: string, salt: string): string {
  const hex = createHash("sha512").update(value + salt, "utf8").digest("hex");
  return Buffer.from(hex).toString("base64");
}

// SHA256: hex(sha256(value + salt)) — matches C# GenerateSHA256Hash implementation
export function hashSHA256(value: string, salt: string): string {
  return createHash("sha256").update(value + salt, "utf8").digest("hex");
}

export function generateSalt(byteLength = 16): string {
  return randomBytes(byteLength).toString("hex");
}
