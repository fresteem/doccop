/**
 * Minimal in-memory rate limiter for the render endpoint.
 *
 * Two windows enforced per user:
 *   - Concurrent in-flight renders (default 5).
 *   - Renders per rolling 60-second window (default 60).
 *
 * The limits live in process memory, so single-process deployments
 * are correctly limited but horizontally-scaled ones need to be set
 * up with a shared store (Redis) — that's the host's job; this
 * default impl is a sane self-contained fallback for the OSS demo
 * and small deployments.
 */

import type { UserId } from "@doccop/core";

interface UserState {
  inFlight: number;
  windowStartMs: number;
  countInWindow: number;
}

export interface RateLimiterOptions {
  maxConcurrent: number;
  maxPerMinute: number;
}

export class InMemoryRateLimiter {
  private state = new Map<UserId, UserState>();
  constructor(private readonly opts: RateLimiterOptions) {}

  /**
   * Try to acquire a slot. Returns `null` if the user is over either
   * limit; otherwise returns a release function the caller MUST invoke
   * (in a finally block) when the render completes.
   */
  acquire(userId: UserId, now: number = Date.now()): null | (() => void) {
    const s = this.stateFor(userId, now);
    if (s.inFlight >= this.opts.maxConcurrent) return null;
    if (s.countInWindow >= this.opts.maxPerMinute) return null;
    s.inFlight++;
    s.countInWindow++;
    return () => {
      s.inFlight = Math.max(0, s.inFlight - 1);
    };
  }

  /**
   * Diagnostic only — current state for a user. Exposed for tests; in
   * production this is internal.
   */
  inspect(userId: UserId): Readonly<UserState> | undefined {
    return this.state.get(userId);
  }

  private stateFor(userId: UserId, now: number): UserState {
    let s = this.state.get(userId);
    if (!s) {
      s = { inFlight: 0, windowStartMs: now, countInWindow: 0 };
      this.state.set(userId, s);
      return s;
    }
    // Roll the window if it's older than 60 s.
    if (now - s.windowStartMs > 60_000) {
      s.windowStartMs = now;
      s.countInWindow = 0;
    }
    return s;
  }
}
