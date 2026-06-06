import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/internal-db", () => ({
  getUserByUsername: vi.fn().mockResolvedValue(null),
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/auth", () => ({
  signToken: vi.fn().mockResolvedValue("mock-jwt-token"),
}));

vi.mock("@/lib/login-limiter", () => ({
  checkLoginAllowed: vi.fn().mockReturnValue({ blocked: false, retryAfterMs: 0 }),
  recordLoginFailure: vi.fn(),
  recordLoginSuccess: vi.fn(),
}));

vi.mock("bcryptjs", () => ({
  default: {
    compare: vi.fn().mockResolvedValue(false),
  },
}));

import { POST } from "@/app/api/auth/login/route";
import { getUserByUsername, logAudit } from "@/lib/internal-db";
import { signToken } from "@/lib/auth";
import { checkLoginAllowed, recordLoginFailure, recordLoginSuccess } from "@/lib/login-limiter";
import bcrypt from "bcryptjs";

const MOCK_USER = { id: 1, username: "alice", password_hash: "hashed", role: "user" as const, created_at: "2024-01-01" };

function makeRequest(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(checkLoginAllowed).mockReturnValue({ blocked: false, retryAfterMs: 0 });
  vi.mocked(getUserByUsername).mockResolvedValue(null);
  vi.mocked(logAudit).mockResolvedValue(undefined);
  vi.mocked(signToken).mockResolvedValue("mock-jwt-token");
  vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
});

describe("input validation", () => {
  it("returns 400 when username is missing", async () => {
    const res = await POST(makeRequest({ password: "pass" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/required/i);
  });

  it("returns 400 when password is missing", async () => {
    const res = await POST(makeRequest({ username: "alice" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when both are missing", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });
});

describe("rate limiting", () => {
  it("returns 429 when checkLoginAllowed is blocked", async () => {
    vi.mocked(checkLoginAllowed).mockReturnValue({ blocked: true, retryAfterMs: 60_000 });
    const res = await POST(makeRequest({ username: "alice", password: "pass" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("rounds Retry-After up (ceil)", async () => {
    vi.mocked(checkLoginAllowed).mockReturnValue({ blocked: true, retryAfterMs: 60_001 });
    const res = await POST(makeRequest({ username: "alice", password: "pass" }));
    expect(res.headers.get("Retry-After")).toBe("61");
  });
});

describe("credential failure", () => {
  it("returns 401 when user is not found", async () => {
    vi.mocked(getUserByUsername).mockResolvedValue(null);
    const res = await POST(makeRequest({ username: "alice", password: "wrong" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid credentials" });
  });

  it("calls recordLoginFailure on unknown username", async () => {
    await POST(makeRequest({ username: "alice", password: "wrong" }));
    expect(vi.mocked(recordLoginFailure)).toHaveBeenCalledWith(null, "alice");
  });

  it("returns 401 when password is wrong", async () => {
    vi.mocked(getUserByUsername).mockResolvedValue(MOCK_USER);
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
    const res = await POST(makeRequest({ username: "alice", password: "wrong" }));
    expect(res.status).toBe(401);
  });

  it("calls recordLoginFailure on wrong password", async () => {
    vi.mocked(getUserByUsername).mockResolvedValue(MOCK_USER);
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
    await POST(makeRequest({ username: "alice", password: "wrong" }));
    expect(vi.mocked(recordLoginFailure)).toHaveBeenCalled();
  });

  it("calls logAudit(LOGIN_FAILED, userId) on wrong password", async () => {
    vi.mocked(getUserByUsername).mockResolvedValue(MOCK_USER);
    vi.mocked(bcrypt.compare).mockResolvedValue(false as never);
    await POST(makeRequest({ username: "alice", password: "wrong" }));
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      expect.objectContaining({ action: "LOGIN_FAILED", userId: MOCK_USER.id })
    );
  });

  it("calls logAudit(LOGIN_FAILED) without userId on unknown username", async () => {
    vi.mocked(getUserByUsername).mockResolvedValue(null);
    await POST(makeRequest({ username: "ghost", password: "pass" }));
    const call = vi.mocked(logAudit).mock.calls[0]?.[0];
    expect(call?.action).toBe("LOGIN_FAILED");
    expect(call?.userId).toBeUndefined();
  });
});

describe("successful login", () => {
  beforeEach(() => {
    vi.mocked(getUserByUsername).mockResolvedValue(MOCK_USER);
    vi.mocked(bcrypt.compare).mockResolvedValue(true as never);
  });

  it("returns 200 with user info", async () => {
    const res = await POST(makeRequest({ username: "alice", password: "correct" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toEqual({ id: 1, username: "alice", role: "user" });
  });

  it("calls recordLoginSuccess", async () => {
    await POST(makeRequest({ username: "alice", password: "correct" }));
    expect(vi.mocked(recordLoginSuccess)).toHaveBeenCalled();
  });

  it("calls logAudit(LOGIN)", async () => {
    await POST(makeRequest({ username: "alice", password: "correct" }));
    expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
      expect.objectContaining({ action: "LOGIN", userId: MOCK_USER.id })
    );
  });

  it("calls signToken with correct payload", async () => {
    await POST(makeRequest({ username: "alice", password: "correct" }));
    expect(vi.mocked(signToken)).toHaveBeenCalledWith({
      sub: MOCK_USER.id,
      username: MOCK_USER.username,
      role: MOCK_USER.role,
    });
  });

  it("sets auth_token cookie with HttpOnly and SameSite", async () => {
    const res = await POST(makeRequest({ username: "alice", password: "correct" }));
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("auth_token=mock-jwt-token");
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
  });
});

describe("IP header extraction", () => {
  beforeEach(() => {
    vi.mocked(getUserByUsername).mockResolvedValue(null);
  });

  it("extracts first IP from x-forwarded-for", async () => {
    await POST(makeRequest({ username: "alice", password: "p" }, { "x-forwarded-for": "1.2.3.4, 5.6.7.8" }));
    expect(vi.mocked(checkLoginAllowed)).toHaveBeenCalledWith("1.2.3.4", "alice");
  });

  it("falls back to x-real-ip", async () => {
    await POST(makeRequest({ username: "alice", password: "p" }, { "x-real-ip": "9.9.9.9" }));
    expect(vi.mocked(checkLoginAllowed)).toHaveBeenCalledWith("9.9.9.9", "alice");
  });

  it("passes null when no IP headers present", async () => {
    await POST(makeRequest({ username: "alice", password: "p" }));
    expect(vi.mocked(checkLoginAllowed)).toHaveBeenCalledWith(null, "alice");
  });
});

describe("internal error handling", () => {
  it("returns 500 when getUserByUsername throws", async () => {
    vi.mocked(getUserByUsername).mockRejectedValue(new Error("DB down"));
    const res = await POST(makeRequest({ username: "alice", password: "pass" }));
    expect(res.status).toBe(500);
  });
});
