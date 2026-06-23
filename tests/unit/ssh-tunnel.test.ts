import { describe, it, expect } from "vitest";
import { rewriteForTunnel, parseDbTarget } from "@/lib/ssh-tunnel";

// ── rewriteForTunnel ─────────────────────────────────────────────────────────

describe("rewriteForTunnel — postgres", () => {
  it("replaces host and port", () => {
    const result = rewriteForTunnel("postgres", "postgresql://user:pass@dbhost:5432/mydb", 12345);
    expect(result).toContain("@127.0.0.1:12345");
  });

  it("preserves username, password, and database path", () => {
    const result = rewriteForTunnel("postgres", "postgresql://alice:secret@dbhost:5432/production", 9000);
    expect(result).toBe("postgresql://alice:secret@127.0.0.1:9000/production");
  });

  it("replaces host when no port in original URL", () => {
    const result = rewriteForTunnel("postgres", "postgresql://user:pass@dbhost/mydb", 9001);
    expect(result).toBe("postgresql://user:pass@127.0.0.1:9001/mydb");
  });

  it("preserves query params (e.g. sslmode)", () => {
    const result = rewriteForTunnel("postgres", "postgresql://user:pass@dbhost:5432/mydb?sslmode=require", 9002);
    expect(result).toBe("postgresql://user:pass@127.0.0.1:9002/mydb?sslmode=require");
  });

  it("handles @ in password without mangling it", () => {
    const result = rewriteForTunnel("postgres", "postgresql://user:p%40ss@dbhost:5432/mydb", 9003);
    expect(result).toBe("postgresql://user:p%40ss@127.0.0.1:9003/mydb");
  });

  it("handles # in password", () => {
    const result = rewriteForTunnel("postgres", "postgresql://user:p#ss@dbhost:5432/mydb", 9004);
    expect(result).toBe("postgresql://user:p#ss@127.0.0.1:9004/mydb");
  });

  it("handles ? in password", () => {
    const result = rewriteForTunnel("postgres", "postgresql://user:p?ss@dbhost:5432/mydb", 9005);
    expect(result).toBe("postgresql://user:p?ss@127.0.0.1:9005/mydb");
  });

  it("handles / in password", () => {
    const result = rewriteForTunnel("postgres", "postgresql://user:p/ss@dbhost:5432/mydb", 9006);
    expect(result).toBe("postgresql://user:p/ss@127.0.0.1:9006/mydb");
  });
});

describe("rewriteForTunnel — mysql", () => {
  it("replaces host and port", () => {
    const result = rewriteForTunnel("mysql", "mysql://user:pass@dbhost:3306/mydb", 13000);
    const url = new URL(result);
    expect(url.hostname).toBe("127.0.0.1");
    expect(url.port).toBe("13000");
  });

  it("preserves the mysql:// scheme", () => {
    const result = rewriteForTunnel("mysql", "mysql://user:pass@dbhost:3306/mydb", 13001);
    expect(result.startsWith("mysql://")).toBe(true);
  });
});

describe("rewriteForTunnel — mariadb", () => {
  it("replaces host and port, preserves mariadb:// scheme", () => {
    const result = rewriteForTunnel("mariadb", "mariadb://user:pass@dbhost:3306/mydb", 14000);
    const url = new URL(result);
    expect(url.hostname).toBe("127.0.0.1");
    expect(url.port).toBe("14000");
    expect(result.startsWith("mariadb://")).toBe(true);
  });
});

describe("rewriteForTunnel — mssql", () => {
  it("replaces Server=host,port", () => {
    const result = rewriteForTunnel("mssql", "Server=dbhost,1433;Database=mydb;User Id=sa;Password=pass", 15000);
    expect(result).toContain("Server=127.0.0.1,15000");
    expect(result).toContain("Database=mydb");
    expect(result).not.toContain("dbhost");
  });

  it("replaces Server=host (no port) and inserts local port", () => {
    const result = rewriteForTunnel("mssql", "Server=dbhost;Database=mydb;User Id=sa;Password=pass", 15001);
    expect(result).toContain("Server=127.0.0.1,15001");
  });

  it("preserves the rest of the connection string", () => {
    const connStr = "Server=dbhost,1433;Database=prod;User Id=sa;Password=s3cr3t;TrustServerCertificate=true";
    const result = rewriteForTunnel("mssql", connStr, 15002);
    expect(result).toContain("Database=prod");
    expect(result).toContain("Password=s3cr3t");
    expect(result).toContain("TrustServerCertificate=true");
  });
});

describe("rewriteForTunnel — sqlite", () => {
  it("returns the connection string unchanged", () => {
    const cs = "/data/myapp.db";
    expect(rewriteForTunnel("sqlite", cs, 9999)).toBe(cs);
  });
});

// ── parseDbTarget ────────────────────────────────────────────────────────────

describe("parseDbTarget — postgres", () => {
  it("extracts host and port from URL", () => {
    expect(parseDbTarget("postgres", "postgresql://user:pass@dbhost:5432/mydb"))
      .toEqual({ host: "dbhost", port: 5432 });
  });

  it("defaults to port 5432 when not specified", () => {
    expect(parseDbTarget("postgres", "postgresql://user:pass@dbhost/mydb"))
      .toEqual({ host: "dbhost", port: 5432 });
  });

  it("handles @ in password", () => {
    expect(parseDbTarget("postgres", "postgresql://user:p@ss@dbhost:5432/mydb"))
      .toEqual({ host: "dbhost", port: 5432 });
  });

  it("handles # in password", () => {
    expect(parseDbTarget("postgres", "postgresql://user:p#ss@dbhost:5432/mydb"))
      .toEqual({ host: "dbhost", port: 5432 });
  });

  it("handles ? in password", () => {
    expect(parseDbTarget("postgres", "postgresql://user:p?ss@dbhost:5432/mydb"))
      .toEqual({ host: "dbhost", port: 5432 });
  });

  it("handles / in password", () => {
    expect(parseDbTarget("postgres", "postgresql://user:p/ss@dbhost:5432/mydb"))
      .toEqual({ host: "dbhost", port: 5432 });
  });
});

describe("parseDbTarget — mysql / mariadb", () => {
  it("extracts host and port from mysql URL", () => {
    expect(parseDbTarget("mysql", "mysql://user:pass@db.internal:3306/mydb"))
      .toEqual({ host: "db.internal", port: 3306 });
  });

  it("defaults to port 3306 for mysql when not specified", () => {
    expect(parseDbTarget("mysql", "mysql://user:pass@dbhost/mydb"))
      .toEqual({ host: "dbhost", port: 3306 });
  });

  it("extracts host and port from mariadb URL", () => {
    expect(parseDbTarget("mariadb", "mariadb://user:pass@dbhost:3307/mydb"))
      .toEqual({ host: "dbhost", port: 3307 });
  });
});

describe("parseDbTarget — mssql", () => {
  it("extracts host and port from Server=host,port format", () => {
    expect(parseDbTarget("mssql", "Server=sqlserver.internal,1433;Database=mydb"))
      .toEqual({ host: "sqlserver.internal", port: 1433 });
  });

  it("defaults to port 1433 when only Server=host", () => {
    expect(parseDbTarget("mssql", "Server=sqlserver.internal;Database=mydb"))
      .toEqual({ host: "sqlserver.internal", port: 1433 });
  });
});

describe("parseDbTarget — sqlite", () => {
  it("throws because SSH tunneling is not supported for SQLite", () => {
    expect(() => parseDbTarget("sqlite", "/data/myapp.db")).toThrow();
  });
});
