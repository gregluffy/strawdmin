import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockQuery = vi.fn().mockResolvedValue([{ ok: 1 }]);
const mockClose = vi.fn().mockResolvedValue(undefined);
const mockCloseTunnel = vi.fn();

vi.mock("@/lib/request-auth", () => ({ getRequestUser: vi.fn() }));
vi.mock("@/lib/drivers", () => ({
  createTempDriver: vi.fn(),
  createTempDriverWithSsh: vi.fn(),
}));

import { POST } from "@/app/api/db-connections/test/route";
import { getRequestUser } from "@/lib/request-auth";
import { createTempDriver, createTempDriverWithSsh } from "@/lib/drivers";

const ADMIN = { id: 1, username: "admin", role: "admin" as const };
const MOCK_DRIVER = { query: mockQuery, close: mockClose, quote: (s: string) => `"${s}"`, placeholder: () => "?", dbType: "postgres" };

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/db-connections/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockResolvedValue([{ ok: 1 }]);
  mockClose.mockResolvedValue(undefined);
  mockCloseTunnel.mockReset();
  vi.mocked(createTempDriver).mockReturnValue(MOCK_DRIVER);
  vi.mocked(createTempDriverWithSsh).mockResolvedValue({ driver: MOCK_DRIVER, closeTunnel: mockCloseTunnel });
});

// ── Auth ─────────────────────────────────────────────────────────────────────

describe("POST /api/db-connections/test — auth", () => {
  it("returns 403 when unauthenticated", async () => {
    vi.mocked(getRequestUser).mockResolvedValue(null);
    const res = await POST(makeRequest({ db_type: "postgres", connection_string: "pg://x" }));
    expect(res.status).toBe(403);
  });

  it("returns 403 for non-admin users", async () => {
    vi.mocked(getRequestUser).mockResolvedValue({ id: 2, username: "user", role: "user" });
    const res = await POST(makeRequest({ db_type: "postgres", connection_string: "pg://x" }));
    expect(res.status).toBe(403);
  });
});

// ── Validation ───────────────────────────────────────────────────────────────

describe("POST /api/db-connections/test — validation", () => {
  beforeEach(() => {
    vi.mocked(getRequestUser).mockResolvedValue(ADMIN);
  });

  it("returns 400 when db_type is missing", async () => {
    const res = await POST(makeRequest({ connection_string: "pg://x" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when connection_string is missing", async () => {
    const res = await POST(makeRequest({ db_type: "postgres" }));
    expect(res.status).toBe(400);
  });
});

// ── Without SSH ──────────────────────────────────────────────────────────────

describe("POST /api/db-connections/test — without SSH", () => {
  beforeEach(() => {
    vi.mocked(getRequestUser).mockResolvedValue(ADMIN);
  });

  it("returns { ok: true } on successful query", async () => {
    const res = await POST(makeRequest({ db_type: "postgres", connection_string: "postgresql://localhost/test" }));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(createTempDriver).toHaveBeenCalledWith("postgres", "postgresql://localhost/test");
  });

  it("closes the driver after a successful test", async () => {
    await POST(makeRequest({ db_type: "postgres", connection_string: "postgresql://localhost/test" }));
    expect(mockClose).toHaveBeenCalledOnce();
  });

  it("returns { ok: false } and closes the driver when query throws", async () => {
    mockQuery.mockRejectedValueOnce(new Error("Connection refused"));
    const res = await POST(makeRequest({ db_type: "postgres", connection_string: "postgresql://badhost/test" }));
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("Connection refused");
    expect(mockClose).toHaveBeenCalledOnce();
  });
});

// ── With SSH ─────────────────────────────────────────────────────────────────

describe("POST /api/db-connections/test — with SSH", () => {
  beforeEach(() => {
    vi.mocked(getRequestUser).mockResolvedValue(ADMIN);
  });

  const SSH_FIELDS = {
    db_type: "postgres",
    connection_string: "postgresql://db.internal/prod",
    ssh: {
      enabled: true,
      host: "bastion.example.com",
      port: 22,
      user: "ubuntu",
      auth_type: "password",
      password: "s3cr3t",
    },
  };

  it("calls createTempDriverWithSsh with correct SSH config", async () => {
    await POST(makeRequest(SSH_FIELDS));
    expect(createTempDriverWithSsh).toHaveBeenCalledWith(
      "postgres",
      "postgresql://db.internal/prod",
      expect.objectContaining({
        host: "bastion.example.com",
        port: 22,
        user: "ubuntu",
        auth_type: "password",
        password: "s3cr3t",
      })
    );
  });

  it("returns { ok: true } on successful tunneled connection", async () => {
    const res = await POST(makeRequest(SSH_FIELDS));
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("closes both driver and tunnel after a successful test", async () => {
    await POST(makeRequest(SSH_FIELDS));
    expect(mockClose).toHaveBeenCalledOnce();
    expect(mockCloseTunnel).toHaveBeenCalledOnce();
  });

  it("closes tunnel even when query throws", async () => {
    mockQuery.mockRejectedValueOnce(new Error("DB unreachable"));
    const res = await POST(makeRequest(SSH_FIELDS));
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(mockClose).toHaveBeenCalledOnce();
    expect(mockCloseTunnel).toHaveBeenCalledOnce();
  });

  it("returns error when SSH host is missing", async () => {
    const res = await POST(makeRequest({
      db_type: "postgres",
      connection_string: "postgresql://db.internal/prod",
      ssh: { enabled: true, user: "ubuntu" },
    }));
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBeTruthy();
  });

  it("returns error when SSH user is missing", async () => {
    const res = await POST(makeRequest({
      db_type: "postgres",
      connection_string: "postgresql://db.internal/prod",
      ssh: { enabled: true, host: "bastion.example.com" },
    }));
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it("passes private_key and passphrase for key auth", async () => {
    await POST(makeRequest({
      db_type: "mysql",
      connection_string: "mysql://db.internal/mydb",
      ssh: {
        enabled: true,
        host: "bastion.example.com",
        port: 22,
        user: "ubuntu",
        auth_type: "key",
        private_key: "-----BEGIN OPENSSH PRIVATE KEY-----\nfakekey",
        passphrase: "myphrase",
      },
    }));
    expect(createTempDriverWithSsh).toHaveBeenCalledWith(
      "mysql",
      "mysql://db.internal/mydb",
      expect.objectContaining({
        auth_type: "key",
        private_key: "-----BEGIN OPENSSH PRIVATE KEY-----\nfakekey",
        passphrase: "myphrase",
      })
    );
  });
});
