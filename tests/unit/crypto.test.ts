import { describe, it, expect } from "vitest";
import { hashSHA256, hashSHA512, generateSalt } from "@/lib/crypto";

describe("hashSHA256", () => {
  it("returns a 64-char hex string", () => {
    const result = hashSHA256("password", "salt");
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic", () => {
    expect(hashSHA256("password", "salt")).toBe(hashSHA256("password", "salt"));
  });

  it("different salts produce different hashes", () => {
    expect(hashSHA256("password", "salt1")).not.toBe(hashSHA256("password", "salt2"));
  });

  it("different values produce different hashes", () => {
    expect(hashSHA256("password1", "salt")).not.toBe(hashSHA256("password2", "salt"));
  });

  it("handles empty value with a salt", () => {
    const result = hashSHA256("", "salt");
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it("handles empty salt", () => {
    const result = hashSHA256("password", "");
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("hashSHA512", () => {
  it("returns a valid base64 string", () => {
    const result = hashSHA512("password", "salt");
    // base64 chars only
    expect(result).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it("is deterministic", () => {
    expect(hashSHA512("password", "salt")).toBe(hashSHA512("password", "salt"));
  });

  it("different salts produce different hashes", () => {
    expect(hashSHA512("password", "salt1")).not.toBe(hashSHA512("password", "salt2"));
  });

  it("different values produce different hashes", () => {
    expect(hashSHA512("password1", "salt")).not.toBe(hashSHA512("password2", "salt"));
  });

  it("SHA256 and SHA512 produce different output for same input", () => {
    expect(hashSHA256("password", "salt")).not.toBe(hashSHA512("password", "salt"));
  });
});

describe("generateSalt", () => {
  it("returns a hex string", () => {
    expect(generateSalt()).toMatch(/^[0-9a-f]+$/);
  });

  it("default (16 bytes) produces 32 hex chars", () => {
    expect(generateSalt()).toHaveLength(32);
  });

  it("generateSalt(8) produces 16 hex chars", () => {
    expect(generateSalt(8)).toHaveLength(16);
  });

  it("generateSalt(32) produces 64 hex chars", () => {
    expect(generateSalt(32)).toHaveLength(64);
  });

  it("two consecutive calls produce different values", () => {
    expect(generateSalt()).not.toBe(generateSalt());
  });
});
