/**
 * Coverage targets:
 * - acquire respects concurrent limit
 * - acquire respects per-minute limit
 * - release decrements in-flight counter
 * - window resets after 60s elapse
 */

import { describe, expect, it } from "vitest";
import { InMemoryRateLimiter } from "../../src/middleware/rate-limit.js";

describe("InMemoryRateLimiter", () => {
  it("respects the concurrent limit", () => {
    const limiter = new InMemoryRateLimiter({ maxConcurrent: 2, maxPerMinute: 100 });
    const r1 = limiter.acquire("u");
    const r2 = limiter.acquire("u");
    const r3 = limiter.acquire("u");
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(r3).toBeNull();
    r1?.();
    const r4 = limiter.acquire("u");
    expect(r4).not.toBeNull();
  });

  it("respects the per-minute limit", () => {
    const limiter = new InMemoryRateLimiter({ maxConcurrent: 100, maxPerMinute: 3 });
    const a = limiter.acquire("u");
    const b = limiter.acquire("u");
    const c = limiter.acquire("u");
    const d = limiter.acquire("u");
    expect([a, b, c].every((x) => x !== null)).toBe(true);
    expect(d).toBeNull();
    a?.();
    b?.();
    c?.();
    // Still hit by per-minute counter even with no in-flight.
    expect(limiter.acquire("u")).toBeNull();
  });

  it("rolls the per-minute window after 60s", () => {
    const limiter = new InMemoryRateLimiter({ maxConcurrent: 100, maxPerMinute: 1 });
    const now = 1_000_000;
    expect(limiter.acquire("u", now)).not.toBeNull();
    expect(limiter.acquire("u", now)).toBeNull();
    // 61 s later, window resets.
    expect(limiter.acquire("u", now + 61_000)).not.toBeNull();
  });

  it("tracks users independently", () => {
    const limiter = new InMemoryRateLimiter({ maxConcurrent: 1, maxPerMinute: 100 });
    expect(limiter.acquire("u1")).not.toBeNull();
    expect(limiter.acquire("u2")).not.toBeNull();
    expect(limiter.acquire("u1")).toBeNull();
  });
});
