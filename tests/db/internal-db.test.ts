import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  _resetForTesting,
  isFirstRun,
  createUser,
  getUsers,
  getUserByUsername,
  getUserById,
  updateUser,
  deleteUser,
  getUserTablePolicy,
  getUserColumnPolicies,
  upsertTablePolicy,
  upsertColumnPolicy,
  getFkSettings,
  upsertFkSetting,
  logAudit,
  getAuditLogs,
  exportAllSettings,
  restoreAllSettings,
} from "@/lib/internal-db";

beforeEach(() => {
  _resetForTesting();
  // INTERNAL_DB_URL=":memory:" is set in vitest.config.ts — each reset creates a fresh DB
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ── isFirstRun ──────────────────────────────────────────────────────────────

describe("isFirstRun", () => {
  it("returns true on empty database", async () => {
    expect(await isFirstRun()).toBe(true);
  });

  it("returns false after a user is created", async () => {
    await createUser("alice", "hash", "admin");
    expect(await isFirstRun()).toBe(false);
  });
});

// ── createUser / getUsers / getUserByUsername / getUserById ─────────────────

describe("createUser", () => {
  it("returns id, username, role, created_at — no password_hash", async () => {
    const user = await createUser("alice", "hash123", "admin");
    expect(user.id).toBeTypeOf("number");
    expect(user.id).toBeGreaterThan(0);
    expect(user.username).toBe("alice");
    expect(user.role).toBe("admin");
    expect(user.created_at).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect((user as Record<string, unknown>).password_hash).toBeUndefined();
  });

  it("throws on duplicate username", async () => {
    await createUser("alice", "hash1", "user");
    await expect(createUser("alice", "hash2", "user")).rejects.toThrow();
  });
});

describe("getUsers", () => {
  it("returns empty array when no users", async () => {
    expect(await getUsers()).toEqual([]);
  });

  it("returns all users without password_hash", async () => {
    await createUser("alice", "hash1", "admin");
    await createUser("bob", "hash2", "user");
    const users = await getUsers();
    expect(users).toHaveLength(2);
    expect(users[0].username).toBe("alice");
    expect(users[1].username).toBe("bob");
    for (const u of users) {
      expect((u as Record<string, unknown>).password_hash).toBeUndefined();
    }
  });
});

describe("getUserByUsername", () => {
  it("returns null for non-existent username", async () => {
    expect(await getUserByUsername("nobody")).toBeNull();
  });

  it("returns full user including password_hash", async () => {
    await createUser("alice", "secret_hash", "admin");
    const user = await getUserByUsername("alice");
    expect(user).not.toBeNull();
    expect(user!.password_hash).toBe("secret_hash");
    expect(user!.role).toBe("admin");
  });

  it("is case-sensitive (Alice vs alice are different)", async () => {
    await createUser("Alice", "hash", "user");
    expect(await getUserByUsername("alice")).toBeNull();
    expect(await getUserByUsername("Alice")).not.toBeNull();
  });
});

describe("getUserById", () => {
  it("returns null for non-existent id", async () => {
    expect(await getUserById(9999)).toBeNull();
  });

  it("returns correct user by id", async () => {
    const created = await createUser("alice", "hash", "user");
    const fetched = await getUserById(created.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.username).toBe("alice");
    expect(fetched!.id).toBe(created.id);
  });
});

// ── updateUser ──────────────────────────────────────────────────────────────

describe("updateUser", () => {
  it("updates password_hash", async () => {
    const u = await createUser("alice", "old_hash", "user");
    await updateUser(u.id, { password_hash: "new_hash" });
    const fetched = await getUserById(u.id);
    expect(fetched!.password_hash).toBe("new_hash");
  });

  it("updates role", async () => {
    const u = await createUser("alice", "hash", "user");
    await updateUser(u.id, { role: "admin" });
    const fetched = await getUserById(u.id);
    expect(fetched!.role).toBe("admin");
  });

  it("returns false and does nothing for empty updates", async () => {
    const u = await createUser("alice", "hash", "user");
    const result = await updateUser(u.id, {});
    expect(result).toBe(false);
    const fetched = await getUserById(u.id);
    expect(fetched!.password_hash).toBe("hash");
  });

  it("returns true for non-existent id (UPDATE runs, 0 rows affected)", async () => {
    // Documented behavior: the function runs UPDATE without checking rows_affected
    const result = await updateUser(9999, { role: "admin" });
    expect(result).toBe(true);
  });
});

// ── deleteUser ──────────────────────────────────────────────────────────────

describe("deleteUser", () => {
  it("deletes existing user and returns true", async () => {
    const u = await createUser("alice", "hash", "user");
    const result = await deleteUser(u.id);
    expect(result).toBe(true);
    expect(await getUserById(u.id)).toBeNull();
  });

  it("returns false for non-existent id", async () => {
    expect(await deleteUser(9999)).toBe(false);
  });
});

// ── policies ────────────────────────────────────────────────────────────────

describe("getUserTablePolicy — defaults", () => {
  it("returns all-true defaults when no policy stored", async () => {
    const policy = await getUserTablePolicy(42, "orders");
    expect(policy).toEqual({
      can_view: true,
      can_insert: true,
      can_update: true,
      can_delete: true,
    });
  });
});

describe("upsertTablePolicy / getUserTablePolicy", () => {
  it("stores and retrieves custom policy", async () => {
    const u = await createUser("alice", "hash", "user");
    await upsertTablePolicy(u.id, "orders", {
      can_view: true,
      can_insert: false,
      can_update: false,
      can_delete: false,
    });
    const policy = await getUserTablePolicy(u.id, "orders");
    expect(policy).toEqual({
      can_view: true,
      can_insert: false,
      can_update: false,
      can_delete: false,
    });
  });

  it("overwrites on second upsert", async () => {
    const u = await createUser("alice", "hash", "user");
    await upsertTablePolicy(u.id, "orders", {
      can_view: false,
      can_insert: false,
      can_update: false,
      can_delete: false,
    });
    await upsertTablePolicy(u.id, "orders", {
      can_view: true,
      can_insert: true,
      can_update: true,
      can_delete: true,
    });
    const policy = await getUserTablePolicy(u.id, "orders");
    expect(policy.can_view).toBe(true);
  });
});

describe("getUserColumnPolicies", () => {
  it("returns empty object when no column policies", async () => {
    expect(await getUserColumnPolicies(42, "orders")).toEqual({});
  });

  it("returns correct column policy after upsert", async () => {
    const u = await createUser("alice", "hash", "user");
    await upsertColumnPolicy(u.id, "orders", "secret_col", { hidden: true, read_only: false });
    const policies = await getUserColumnPolicies(u.id, "orders");
    expect(policies).toEqual({
      secret_col: { hidden: true, read_only: false },
    });
  });

  it("handles multiple columns", async () => {
    const u = await createUser("alice", "hash", "user");
    await upsertColumnPolicy(u.id, "orders", "col_a", { hidden: true, read_only: false });
    await upsertColumnPolicy(u.id, "orders", "col_b", { hidden: false, read_only: true });
    const policies = await getUserColumnPolicies(u.id, "orders");
    expect(policies.col_a).toEqual({ hidden: true, read_only: false });
    expect(policies.col_b).toEqual({ hidden: false, read_only: true });
  });
});

// ── audit logs ──────────────────────────────────────────────────────────────

describe("logAudit / getAuditLogs", () => {
  it("logs one entry and retrieves it", async () => {
    await logAudit({ username: "alice", action: "LOGIN", ip: "1.2.3.4" });
    const { total, logs } = await getAuditLogs({});
    expect(total).toBe(1);
    expect(logs[0].username).toBe("alice");
    expect(logs[0].action).toBe("LOGIN");
    expect(logs[0].ip).toBe("1.2.3.4");
  });

  it("filters by action", async () => {
    await logAudit({ username: "alice", action: "LOGIN" });
    await logAudit({ username: "alice", action: "INSERT", tableName: "orders" });
    await logAudit({ username: "alice", action: "DELETE", tableName: "orders" });
    const { total } = await getAuditLogs({ action: "INSERT" });
    expect(total).toBe(1);
  });

  it("filters by tableName", async () => {
    await logAudit({ username: "alice", action: "INSERT", tableName: "orders" });
    await logAudit({ username: "alice", action: "INSERT", tableName: "customers" });
    const { total } = await getAuditLogs({ tableName: "orders" });
    expect(total).toBe(1);
  });

  it("filters by username (partial LIKE match)", async () => {
    await logAudit({ username: "alice_admin", action: "LOGIN" });
    await logAudit({ username: "bob", action: "LOGIN" });
    const { total } = await getAuditLogs({ username: "alice" });
    expect(total).toBe(1);
  });

  it("paginates correctly", async () => {
    for (let i = 0; i < 5; i++) {
      await logAudit({ username: "alice", action: "LOGIN" });
    }
    const { total, logs } = await getAuditLogs({ page: 2, pageSize: 2 });
    expect(total).toBe(5);
    expect(logs).toHaveLength(2);
  });

  it("returns parsed changes object, not raw JSON string", async () => {
    const changes = { before: { name: "old" }, after: { name: "new" } };
    await logAudit({ username: "alice", action: "UPDATE", tableName: "users", changes });
    const { logs } = await getAuditLogs({ action: "UPDATE" });
    expect(logs[0].changes).toEqual(changes);
  });
});

// ── exportAllSettings / restoreAllSettings ──────────────────────────────────

describe("exportAllSettings / restoreAllSettings round-trip", () => {
  it("exports and restores settings without data loss", async () => {
    const bob = await createUser("bob", "hash", "user");
    await upsertTablePolicy(bob.id, "orders", {
      can_view: true,
      can_insert: false,
      can_update: false,
      can_delete: false,
    });
    await upsertColumnPolicy(bob.id, "orders", "secret", { hidden: true, read_only: false });

    const exported = await exportAllSettings();

    // Reset DB and recreate bob
    _resetForTesting();
    const bob2 = await createUser("bob", "hash", "user");

    const { skipped_users } = await restoreAllSettings(exported);
    expect(skipped_users).toEqual([]);

    const policy = await getUserTablePolicy(bob2.id, "orders");
    expect(policy.can_insert).toBe(false);

    const colPolicies = await getUserColumnPolicies(bob2.id, "orders");
    expect(colPolicies.secret?.hidden).toBe(true);
  });

  it("skips policy entries for unknown usernames", async () => {
    const fakeBackup = {
      table_policies: [
        {
          username: "ghost",
          table_name: "orders",
          can_view: false,
          can_insert: false,
          can_update: false,
          can_delete: false,
        },
      ],
    };
    const { skipped_users } = await restoreAllSettings(fakeBackup);
    expect(skipped_users).toContain("ghost");
  });
});

// ── pruneStaleSettings ──────────────────────────────────────────────────────

describe("pruneStaleSettings", () => {
  it("deletes settings for old fingerprint when a new one is activated", async () => {
    // Create FK setting under "sqlite:test" (our default fingerprint)
    await upsertFkSetting("orders", "customer_id", "name");
    const before = await getFkSettings("orders");
    expect(before).toHaveLength(1);

    // Switch to a different connection string → fingerprint becomes "sqlite:other"
    vi.stubEnv("DB_CONNECTION_STRING", "other");

    // Trigger any fingerprint-touching operation — pruneStaleSettings deletes "sqlite:test" rows
    await getFkSettings("orders"); // reads under "sqlite:other", prunes "sqlite:test"

    // Restore original fingerprint
    vi.unstubAllEnvs();

    // The "sqlite:test" FK setting should now be gone
    const after = await getFkSettings("orders");
    expect(after).toHaveLength(0);
  });
});
