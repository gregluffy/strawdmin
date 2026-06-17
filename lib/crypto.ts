import { createHash, randomBytes } from "crypto";

// SHA512 (custom): base64(hex(sha512(value + salt))) — matches C# DoHash implementation
export function hashSHA512(value: string, salt: string): string {
  const hex = createHash("sha512").update(value + salt, "utf8").digest("hex");
  return Buffer.from(hex).toString("base64");
}

// SHA512 (standard): hex(sha512(value + salt))
export function hashSHA512Standard(value: string, salt: string): string {
  return createHash("sha512").update(value + salt, "utf8").digest("hex");
}

// SHA256: hex(sha256(value + salt)) — matches C# GenerateSHA256Hash implementation
export function hashSHA256(value: string, salt: string): string {
  return createHash("sha256").update(value + salt, "utf8").digest("hex");
}

export function generateSalt(byteLength = 16): string {
  return randomBytes(byteLength).toString("hex");
}

// Maps internal algorithm identifiers to display labels
export function getAlgorithmLabel(algorithm: string): string {
  if (algorithm === "SHA512") return "SHA512 (custom)";
  if (algorithm === "SHA512_STD") return "SHA512";
  return algorithm;
}
