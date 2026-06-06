import { db } from "@/lib/internal-db";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 10;
const LOCKOUT_MS = 15 * 60 * 1000;

async function check(key: string): Promise<{ blocked: boolean; retryAfterMs: number }> {
  const c = await db();
  const now = Date.now();
  const result = await c.execute({
    sql: "SELECT fails, window_start, locked_until FROM login_rate_limits WHERE key = ?",
    args: [key],
  });
  if (result.rows.length === 0) return { blocked: false, retryAfterMs: 0 };

  const row = result.rows[0];
  const lockedUntil = Number(row.locked_until);
  const windowStart = Number(row.window_start);

  if (lockedUntil > now) {
    return { blocked: true, retryAfterMs: lockedUntil - now };
  }

  if (now - windowStart > WINDOW_MS) {
    await c.execute({ sql: "DELETE FROM login_rate_limits WHERE key = ?", args: [key] });
  }

  return { blocked: false, retryAfterMs: 0 };
}

async function recordFailure(key: string): Promise<void> {
  const c = await db();
  const now = Date.now();
  const result = await c.execute({
    sql: "SELECT fails, window_start FROM login_rate_limits WHERE key = ?",
    args: [key],
  });

  let fails: number;
  let windowStart: number;

  if (result.rows.length === 0 || now - Number(result.rows[0].window_start) > WINDOW_MS) {
    fails = 1;
    windowStart = now;
  } else {
    fails = Number(result.rows[0].fails) + 1;
    windowStart = Number(result.rows[0].window_start);
  }

  const lockedUntil = fails >= MAX_FAILS ? now + LOCKOUT_MS : 0;

  await c.execute({
    sql: "INSERT OR REPLACE INTO login_rate_limits (key, fails, window_start, locked_until) VALUES (?, ?, ?, ?)",
    args: [key, fails, windowStart, lockedUntil],
  });
}

async function recordSuccess(key: string): Promise<void> {
  const c = await db();
  await c.execute({ sql: "DELETE FROM login_rate_limits WHERE key = ?", args: [key] });
}

export async function checkLoginAllowed(
  ip: string | null,
  username: string
): Promise<{ blocked: boolean; retryAfterMs: number }> {
  const ipKey = `ip:${ip ?? "unknown"}`;
  const userKey = `user:${username.toLowerCase()}`;

  const byIp = await check(ipKey);
  if (byIp.blocked) return byIp;

  const byUser = await check(userKey);
  if (byUser.blocked) return byUser;

  return { blocked: false, retryAfterMs: 0 };
}

export async function recordLoginFailure(ip: string | null, username: string): Promise<void> {
  await recordFailure(`ip:${ip ?? "unknown"}`);
  await recordFailure(`user:${username.toLowerCase()}`);
}

export async function recordLoginSuccess(ip: string | null, username: string): Promise<void> {
  await recordSuccess(`ip:${ip ?? "unknown"}`);
  await recordSuccess(`user:${username.toLowerCase()}`);
}

/** @internal */
export async function _resetForTesting(): Promise<void> {
  const c = await db();
  await c.execute("DELETE FROM login_rate_limits");
}
