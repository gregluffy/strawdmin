/**
 * Live search tests against real databases — the free-text search scenario
 * from a PascalCase EF Core schema (DeviceStatuses → Devices) with MAC
 * addresses. Runs the real route handler, drivers and introspection; only
 * auth / connection resolution / internal settings are mocked.
 *
 * Opt-in: each database runs only when its connection string is set, e.g.
 *   IT_POSTGRES=postgres://postgres:pw@localhost:55432/postgres
 *   IT_MYSQL=mysql://root:pw@localhost:53306/t
 *   IT_MARIADB=mariadb://root:pw@localhost:53307/t
 *   IT_MSSQL="Server=localhost,51433;Database=master;User Id=sa;Password=...;TrustServerCertificate=true"
 *   IT_SQLITE=1   (in-memory file, always available)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

vi.mock("@/lib/request-auth", () => ({ getRequestUser: vi.fn() }));
vi.mock("@/lib/active-connection", () => ({ getActiveConnection: vi.fn() }));
vi.mock("@/lib/internal-db", () => ({
  getUserTablePolicy: vi.fn(),
  getUserColumnPolicies: vi.fn(),
  logAudit: vi.fn(),
  getFkSettings: vi.fn(),
}));

import { GET } from "@/app/api/tables/[table]/route";
import { getDriver, closeDriver } from "@/lib/drivers";
import { clearSchemaCache } from "@/lib/introspect";
import { getRequestUser } from "@/lib/request-auth";
import { getActiveConnection } from "@/lib/active-connection";
import { getFkSettings, getUserColumnPolicies } from "@/lib/internal-db";
import type { DbConnection, DbType } from "@/lib/types";

const sqliteFile = path.join(os.tmpdir(), `strawdmin-it-${process.pid}.db`);

interface Target {
  dbType: DbType;
  connStr: string | undefined;
  ddl: string[];
  /** Postgres also gets a native `macaddr` column. */
  nativeMac?: boolean;
}

const MAC_ROWS = [
  // Id, DeviceId, MacAddress, Status, IsOnline, CreatedAt
  [1, 1, "80:f3:da:50:0e:3c", 1, 1, "2026-09-01 10:15:00"],
  [2, 2, "80:F3:DA:50:0E:3D", 0, 0, "2026-08-15 08:00:00"],
  [3, 1, "aa:bb:cc:dd:ee:ff", 1, 1, "2025-01-02 12:00:00"],
  [4, 2, "50%_off", 1, 0, "2025-03-03 03:03:03"],
] as const;

function inserts(q: (s: string) => string, bool: (b: number) => string, nativeMac = false): string[] {
  return [
    `INSERT INTO ${q("Devices")} (${q("Id")}, ${q("Name")}, ${q("Serial")}) VALUES (1, 'Gateway Alpha', 5000), (2, 'Sensor Beta', 42)`,
    ...MAC_ROWS.map(([id, dev, mac, st, on, at]) =>
      `INSERT INTO ${q("DeviceStatuses")} (${q("Id")}, ${q("DeviceId")}, ${q("MacAddress")}, ${q("Status")}, ${q("IsOnline")}, ${q("CreatedAt")}${nativeMac ? `, ${q("HwAddr")}` : ""}) ` +
      `VALUES (${id}, ${dev}, '${mac}', ${st}, ${bool(on)}, '${at}'${nativeMac ? (mac.includes("%") ? ", NULL" : `, '${mac}'`) : ""})`
    ),
  ];
}

const dq = (s: string) => `"${s}"`;
const bt = (s: string) => `\`${s}\``;
const br = (s: string) => `[${s}]`;

const mysqlDdl = [
  "DROP TABLE IF EXISTS `DeviceStatuses`",
  "DROP TABLE IF EXISTS `Devices`",
  "CREATE TABLE `Devices` (`Id` INT PRIMARY KEY, `Name` VARCHAR(100) NOT NULL, `Serial` INT NOT NULL)",
  "CREATE TABLE `DeviceStatuses` (`Id` INT PRIMARY KEY, `DeviceId` INT NOT NULL, `MacAddress` VARCHAR(17) NOT NULL, `Status` INT NOT NULL, `IsOnline` TINYINT(1) NOT NULL, `CreatedAt` DATETIME NOT NULL, `Payload` JSON NULL, FOREIGN KEY (`DeviceId`) REFERENCES `Devices`(`Id`))",
  ...inserts(bt, (b) => String(b)),
];

const TARGETS: Target[] = [
  {
    dbType: "postgres",
    connStr: process.env.IT_POSTGRES,
    nativeMac: true,
    ddl: [
      `DROP TABLE IF EXISTS "DeviceStatuses"`,
      `DROP TABLE IF EXISTS "Devices"`,
      `CREATE TABLE "Devices" ("Id" integer PRIMARY KEY, "Name" text NOT NULL, "Serial" integer NOT NULL)`,
      `CREATE TABLE "DeviceStatuses" ("Id" integer PRIMARY KEY, "DeviceId" integer NOT NULL REFERENCES "Devices"("Id"), "MacAddress" varchar(17) NOT NULL, "HwAddr" macaddr NULL, "Status" integer NOT NULL, "IsOnline" boolean NOT NULL, "CreatedAt" timestamp with time zone NOT NULL, "Payload" jsonb NULL, "Uid" uuid NULL)`,
      ...inserts(dq, (b) => (b ? "true" : "false"), true),
    ],
  },
  { dbType: "mysql", connStr: process.env.IT_MYSQL, ddl: mysqlDdl },
  { dbType: "mariadb", connStr: process.env.IT_MARIADB, ddl: mysqlDdl },
  {
    dbType: "mssql",
    connStr: process.env.IT_MSSQL,
    ddl: [
      "IF OBJECT_ID('dbo.DeviceStatuses') IS NOT NULL DROP TABLE [DeviceStatuses]",
      "IF OBJECT_ID('dbo.Devices') IS NOT NULL DROP TABLE [Devices]",
      "CREATE TABLE [Devices] ([Id] INT PRIMARY KEY, [Name] NVARCHAR(100) NOT NULL, [Serial] INT NOT NULL)",
      "CREATE TABLE [DeviceStatuses] ([Id] INT PRIMARY KEY, [DeviceId] INT NOT NULL REFERENCES [Devices]([Id]), [MacAddress] NVARCHAR(17) NOT NULL, [Status] INT NOT NULL, [IsOnline] BIT NOT NULL, [CreatedAt] DATETIME2 NOT NULL, [Payload] NVARCHAR(MAX) NULL, [Uid] UNIQUEIDENTIFIER NULL, [RowVer] ROWVERSION)",
      ...inserts(br, (b) => String(b)),
    ],
  },
  {
    dbType: "sqlite",
    connStr: process.env.IT_SQLITE ? `file:${sqliteFile}` : undefined,
    ddl: [
      `DROP TABLE IF EXISTS "DeviceStatuses"`,
      `DROP TABLE IF EXISTS "Devices"`,
      `CREATE TABLE "Devices" ("Id" INTEGER PRIMARY KEY, "Name" TEXT NOT NULL, "Serial" INTEGER NOT NULL)`,
      `CREATE TABLE "DeviceStatuses" ("Id" INTEGER PRIMARY KEY, "DeviceId" INTEGER NOT NULL REFERENCES "Devices"("Id"), "MacAddress" TEXT NOT NULL, "Status" INTEGER NOT NULL, "IsOnline" BOOLEAN NOT NULL, "CreatedAt" DATETIME NOT NULL, "Payload" JSON NULL)`,
      ...inserts(dq, (b) => String(b)),
    ],
  },
];

let connId = 9000;

for (const target of TARGETS) {
  describe.skipIf(!target.connStr)(`live search — ${target.dbType}`, () => {
    const conn: DbConnection = {
      id: ++connId,
      name: target.dbType,
      db_type: target.dbType,
      connection_string: target.connStr ?? "",
      created_at: "",
    };

    beforeAll(async () => {
      const driver = getDriver(conn);
      for (const sql of target.ddl) await driver.query(sql);
      clearSchemaCache(conn.id);
    }, 60_000);

    afterAll(async () => {
      await closeDriver(conn.id);
      if (target.dbType === "sqlite") fs.rmSync(sqliteFile, { force: true });
    });

    beforeEach(() => {
      vi.mocked(getRequestUser).mockResolvedValue({ sub: 1, username: "admin", role: "admin" as const });
      vi.mocked(getActiveConnection).mockResolvedValue(conn);
      vi.mocked(getUserColumnPolicies).mockResolvedValue({});
      vi.mocked(getFkSettings).mockResolvedValue([]);
    });

    async function search(term: string, extra: Record<string, string> = {}) {
      const url = new URL("http://localhost/api/tables/DeviceStatuses");
      url.searchParams.set("search", term);
      url.searchParams.set("sort", "Id");
      url.searchParams.set("dir", "asc");
      for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
      const res = await GET(new NextRequest(url), { params: Promise.resolve({ table: "DeviceStatuses" }) });
      const body = await res.json();
      if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${body.error}`);
      return { ids: (body.rows as { Id: number }[]).map((r) => Number(r.Id)), total: body.total as number };
    }

    it("finds the exact MAC address from the bug report", async () => {
      expect((await search("80:f3:da:50:0e:3c")).ids).toEqual([1]);
    });

    it("matches MACs case-insensitively", async () => {
      expect((await search("80:F3:DA:50:0E:3C")).ids).toEqual([1]);
      expect((await search("80:f3:da:50:0e:3d")).ids).toEqual([2]);
    });

    it("matches a partial MAC / OUI prefix", async () => {
      expect((await search("80:f3:da")).ids).toEqual([1, 2]);
      expect((await search("0e:3d")).ids).toEqual([2]);
    });

    it("matches a MAC written with dashes or without separators", async () => {
      expect((await search("80-F3-DA-50-0E-3C")).ids).toEqual([1]);
      expect((await search("80f3da500e3c")).ids).toEqual([1]);
    });

    it("works with an integer FK display column configured (the original error)", async () => {
      vi.mocked(getFkSettings).mockResolvedValue([{ column_name: "DeviceId", display_path: ["Serial"] }]);
      expect((await search("80:f3:da:50:0e:3c")).ids).toEqual([1]);
      // numeric term hits the FK display value (Serial 42 → device 2)
      expect((await search("42")).ids).toEqual([2, 4]);
    });

    it("searches FK display text and combines words with AND", async () => {
      vi.mocked(getFkSettings).mockResolvedValue([{ column_name: "DeviceId", display_path: ["Name"] }]);
      expect((await search("gateway")).ids).toEqual([1, 3]);
      expect((await search("gateway 80:f3")).ids).toEqual([1]);
      expect((await search(`"sensor beta" 0e:3d`)).ids).toEqual([2]);
    });

    it("matches integer columns by value, not substring", async () => {
      // "4" appears in no MAC/text, so only Id = 4 matches (not 14, 40, …)
      expect((await search("4")).ids).toEqual([4]);
    });

    it("matches dates by ISO prefix", async () => {
      expect((await search("2026-09")).ids).toEqual([1]);
      expect((await search("2025")).ids).toEqual([3, 4]);
    });

    it("treats LIKE wildcards literally", async () => {
      expect((await search("50%_off")).ids).toEqual([4]);
      expect((await search("%")).ids).toEqual([4]);
      expect((await search("_")).ids).toEqual([4]);
    });

    it("returns nothing for a term no column can match", async () => {
      expect((await search("zz:zz:zz")).total).toBe(0);
    });

    it("keeps pagination totals consistent with the search", async () => {
      const r = await search("80:f3", { pageSize: "1", page: "2" });
      expect(r.total).toBe(2);
      expect(r.ids).toEqual([2]);
    });

    it("applies a contains filter to a non-text column without erroring", async () => {
      const filters = JSON.stringify([{ column: "Status", operator: "contains", value: "1" }]);
      expect((await search("", { filters })).ids).toEqual([1, 3, 4]);
    });

    it.runIf(target.nativeMac)("searches a native macaddr column in any notation", async () => {
      vi.mocked(getUserColumnPolicies).mockResolvedValue({});
      vi.mocked(getRequestUser).mockResolvedValue({ sub: 2, username: "u", role: "user" as const });
      // Hide the varchar copy so only the native macaddr column can match.
      vi.mocked(getUserColumnPolicies).mockResolvedValue({ MacAddress: { hidden: true, read_only: false } });
      const { getUserTablePolicy } = await import("@/lib/internal-db");
      vi.mocked(getUserTablePolicy).mockResolvedValue({ can_view: true, can_insert: false, can_update: false, can_delete: false });
      expect((await search("80:F3:DA:50:0E:3C")).ids).toEqual([1]);
      expect((await search("80-f3-da-50-0e-3c")).ids).toEqual([1]);
      expect((await search("80:f3:da")).ids).toEqual([1, 2]);
    });
  });
}
