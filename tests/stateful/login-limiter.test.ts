import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  checkLoginAllowed,
  recordLoginFailure,
  recordLoginSuccess,
  _resetForTesting,
} from "@/lib/login-limiter";

const MAX_FAILS = 10;
const WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;

beforeEach(() => {
  _resetForTesting();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("initial state", () => {
  it("allows login when no attempts recorded", () => {
    expect(checkLoginAllowed("1.2.3.4", "alice")).toEqual({ blocked: false, retryAfterMs: 0 });
  });

  it("treats null IP as unknown without throwing", () => {
    expect(checkLoginAllowed(null, "alice")).toEqual({ blocked: false, retryAfterMs: 0 });
  });
});

describe("failure counting", () => {
  it("allows login after fewer than MAX_FAILS failures", () => {
    for (let i = 0; i < MAX_FAILS - 1; i++) {
      recordLoginFailure("1.2.3.4", "alice");
    }
    expect(checkLoginAllowed("1.2.3.4", "alice").blocked).toBe(false);
  });

  it("blocks login after exactly MAX_FAILS failures", () => {
    for (let i = 0; i < MAX_FAILS; i++) {
      recordLoginFailure("1.2.3.4", "alice");
    }
    expect(checkLoginAllowed("1.2.3.4", "alice").blocked).toBe(true);
  });

  it("retryAfterMs is approximately LOCKOUT_MS when just locked", () => {
    for (let i = 0; i < MAX_FAILS; i++) {
      recordLoginFailure("1.2.3.4", "alice");
    }
    const { retryAfterMs } = checkLoginAllowed("1.2.3.4", "alice");
    expect(retryAfterMs).toBeGreaterThan(LOCKOUT_MS - 100);
    expect(retryAfterMs).toBeLessThanOrEqual(LOCKOUT_MS);
  });
});

describe("lockout expiry", () => {
  it("unblocks after LOCKOUT_MS elapses", () => {
    for (let i = 0; i < MAX_FAILS; i++) {
      recordLoginFailure("1.2.3.4", "alice");
    }
    vi.advanceTimersByTime(LOCKOUT_MS + 1);
    expect(checkLoginAllowed("1.2.3.4", "alice").blocked).toBe(false);
  });

  it("still blocked 1ms before lockout expires", () => {
    for (let i = 0; i < MAX_FAILS; i++) {
      recordLoginFailure("1.2.3.4", "alice");
    }
    vi.advanceTimersByTime(LOCKOUT_MS - 1);
    expect(checkLoginAllowed("1.2.3.4", "alice").blocked).toBe(true);
  });
});

describe("window reset", () => {
  it("resets counter after WINDOW_MS without a lockout", () => {
    for (let i = 0; i < MAX_FAILS - 1; i++) {
      recordLoginFailure("1.2.3.4", "alice");
    }
    vi.advanceTimersByTime(WINDOW_MS + 1);
    // Window expired — counter should be gone; MAX_FAILS - 1 more shouldn't block
    for (let i = 0; i < MAX_FAILS - 1; i++) {
      recordLoginFailure("1.2.3.4", "alice");
    }
    expect(checkLoginAllowed("1.2.3.4", "alice").blocked).toBe(false);
  });
});

describe("recordLoginSuccess", () => {
  it("clears block after reaching MAX_FAILS", () => {
    for (let i = 0; i < MAX_FAILS; i++) {
      recordLoginFailure("1.2.3.4", "alice");
    }
    expect(checkLoginAllowed("1.2.3.4", "alice").blocked).toBe(true);
    recordLoginSuccess("1.2.3.4", "alice");
    expect(checkLoginAllowed("1.2.3.4", "alice").blocked).toBe(false);
  });
});

describe("IP and username isolation", () => {
  it("IP block applies to any username from that IP", () => {
    for (let i = 0; i < MAX_FAILS; i++) {
      recordLoginFailure("1.2.3.4", "alice");
    }
    // Different username, same IP → still blocked
    expect(checkLoginAllowed("1.2.3.4", "bob").blocked).toBe(true);
  });

  it("username block applies from any IP", () => {
    for (let i = 0; i < MAX_FAILS; i++) {
      recordLoginFailure("1.2.3.4", "alice");
    }
    // Different IP, same username → still blocked
    expect(checkLoginAllowed("9.9.9.9", "alice").blocked).toBe(true);
  });

  it("different IP and different username are independent", () => {
    for (let i = 0; i < MAX_FAILS; i++) {
      recordLoginFailure("1.2.3.4", "alice");
    }
    // Completely different key → not blocked
    expect(checkLoginAllowed("2.2.2.2", "bob").blocked).toBe(false);
  });

  it("username matching is case-insensitive", () => {
    for (let i = 0; i < MAX_FAILS; i++) {
      recordLoginFailure("1.2.3.4", "Alice");
    }
    // "ALICE" should map to same key as "Alice"
    expect(checkLoginAllowed("9.9.9.9", "ALICE").blocked).toBe(true);
  });

  it("null IP uses the unknown key, isolated from real IPs", () => {
    for (let i = 0; i < MAX_FAILS; i++) {
      recordLoginFailure(null, "alice");
    }
    // Real IP with same username is still blocked (username key)
    expect(checkLoginAllowed("1.2.3.4", "alice").blocked).toBe(true);
    // Different username from real IP → only the null-IP key is locked, not this
    expect(checkLoginAllowed("1.2.3.4", "bob").blocked).toBe(false);
  });
});
