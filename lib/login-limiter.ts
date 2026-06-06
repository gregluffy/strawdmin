const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 10;
const LOCKOUT_MS = 15 * 60 * 1000;

interface Entry {
  fails: number;
  windowStart: number;
  lockedUntil: number;
}

const store = new Map<string, Entry>();

function check(key: string): { blocked: boolean; retryAfterMs: number } {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry) return { blocked: false, retryAfterMs: 0 };

  if (now < entry.lockedUntil) {
    return { blocked: true, retryAfterMs: entry.lockedUntil - now };
  }

  // Window expired — stale entry, clean up
  if (now - entry.windowStart > WINDOW_MS) {
    store.delete(key);
    return { blocked: false, retryAfterMs: 0 };
  }

  return { blocked: false, retryAfterMs: 0 };
}

function recordFailure(key: string): void {
  const now = Date.now();
  let entry = store.get(key);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    entry = { fails: 0, windowStart: now, lockedUntil: 0 };
  }

  entry.fails += 1;
  if (entry.fails >= MAX_FAILS) {
    entry.lockedUntil = now + LOCKOUT_MS;
  }
  store.set(key, entry);
}

function recordSuccess(key: string): void {
  store.delete(key);
}

export function checkLoginAllowed(ip: string | null, username: string): { blocked: boolean; retryAfterMs: number } {
  const ipKey = `ip:${ip ?? "unknown"}`;
  const userKey = `user:${username.toLowerCase()}`;

  const byIp = check(ipKey);
  if (byIp.blocked) return byIp;

  const byUser = check(userKey);
  if (byUser.blocked) return byUser;

  return { blocked: false, retryAfterMs: 0 };
}

export function recordLoginFailure(ip: string | null, username: string): void {
  recordFailure(`ip:${ip ?? "unknown"}`);
  recordFailure(`user:${username.toLowerCase()}`);
}

export function recordLoginSuccess(ip: string | null, username: string): void {
  recordSuccess(`ip:${ip ?? "unknown"}`);
  recordSuccess(`user:${username.toLowerCase()}`);
}

/** @internal */
export function _resetForTesting(): void {
  store.clear();
}
