import { describe, it, expect, beforeEach } from "vitest";
import {
  _resetForTesting,
  createUser,
  createDbConnection,
  setUserDbAccess,
} from "@/lib/internal-db";
import { resolveActiveConnection } from "@/lib/connection-access";

beforeEach(() => {
  _resetForTesting();
});

async function seed() {
  const alice = await createUser("alice", "hash", "user");
  const alpha = await createDbConnection("Alpha", "postgres", "pg://a");
  const beta = await createDbConnection("Beta", "mysql", "my://b");
  return { alice, alpha, beta };
}

describe("resolveActiveConnection — unrestricted users", () => {
  it("honours the active_db_id cookie", async () => {
    const { alice, beta } = await seed();
    const conn = await resolveActiveConnection(String(beta.id), alice.id);
    expect(conn?.name).toBe("Beta");
  });

  it("returns null when the cookie is absent and several connections exist", async () => {
    const { alice } = await seed();
    expect(await resolveActiveConnection(undefined, alice.id)).toBeNull();
  });

  it("falls back to the only connection when there is exactly one", async () => {
    const alice = await createUser("alice", "hash", "user");
    await createDbConnection("Solo", "sqlite", "/tmp/solo.db");
    expect((await resolveActiveConnection(undefined, alice.id))?.name).toBe("Solo");
  });

  it("ignores a cookie pointing at a deleted connection", async () => {
    const { alice } = await seed();
    expect(await resolveActiveConnection("9999", alice.id)).toBeNull();
  });
});

describe("resolveActiveConnection — restricted users", () => {
  it("refuses a cookie pointing at a connection the user was not granted", async () => {
    const { alice, alpha, beta } = await seed();
    await setUserDbAccess(alice.id, "restricted", [alpha.id]);
    // Cookie says Beta, grant says Alpha only — must land on Alpha, never Beta
    const conn = await resolveActiveConnection(String(beta.id), alice.id);
    expect(conn?.name).toBe("Alpha");
  });

  it("honours a cookie pointing at a granted connection", async () => {
    const { alice, beta } = await seed();
    await setUserDbAccess(alice.id, "restricted", [beta.id]);
    expect((await resolveActiveConnection(String(beta.id), alice.id))?.name).toBe("Beta");
  });

  it("falls back to a granted connection when the cookie is absent", async () => {
    const { alice, beta } = await seed();
    await setUserDbAccess(alice.id, "restricted", [beta.id]);
    expect((await resolveActiveConnection(undefined, alice.id))?.name).toBe("Beta");
  });

  it("returns null for a user granted nothing", async () => {
    const { alice, alpha } = await seed();
    await setUserDbAccess(alice.id, "restricted", []);
    expect(await resolveActiveConnection(String(alpha.id), alice.id)).toBeNull();
    expect(await resolveActiveConnection(undefined, alice.id)).toBeNull();
  });

  it("does not leak the single-connection fallback past a grant", async () => {
    const alice = await createUser("alice", "hash", "user");
    const solo = await createDbConnection("Solo", "sqlite", "/tmp/solo.db");
    await setUserDbAccess(alice.id, "restricted", []);
    expect(await resolveActiveConnection(String(solo.id), alice.id)).toBeNull();
  });

  it("restricts admins the same way as regular users", async () => {
    const admin = await createUser("root", "hash", "admin");
    const alpha = await createDbConnection("Alpha", "postgres", "pg://a");
    const beta = await createDbConnection("Beta", "mysql", "my://b");
    await setUserDbAccess(admin.id, "restricted", [alpha.id]);
    expect((await resolveActiveConnection(String(beta.id), admin.id))?.name).toBe("Alpha");
  });
});

describe("resolveActiveConnection — no identified user", () => {
  it("treats a null user id as unrestricted", async () => {
    const { beta } = await seed();
    expect((await resolveActiveConnection(String(beta.id), null))?.name).toBe("Beta");
  });
});
