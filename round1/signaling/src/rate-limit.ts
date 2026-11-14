// Brute-force protection for viewer `connect` attempts.
//
// Two layers per PRD §7:
//   1. Per-IP sliding window: at most N attempts per minute.
//   2. Per-IP wrong-attempt lockout: after M consecutive wrong codes from an
//      IP, lock that IP out for `lockoutMs`. A successful pair resets the
//      wrong counter.

export type CheckResult =
  | { allowed: true }
  | { allowed: false; reason: "rate_limited" };

export type RateLimiterOptions = {
  perMinute: number;
  wrongAttemptsBeforeLockout: number;
  lockoutMs: number;
  now?: () => number;
};

const WINDOW_MS = 60_000;

export class RateLimiter {
  private readonly perMinute: number;
  private readonly wrongAttemptsBeforeLockout: number;
  private readonly lockoutMs: number;
  private readonly now: () => number;

  private readonly attempts = new Map<string, number[]>();
  private readonly wrongCounts = new Map<string, number>();
  private readonly lockedUntil = new Map<string, number>();

  constructor(opts: RateLimiterOptions) {
    this.perMinute = opts.perMinute;
    this.wrongAttemptsBeforeLockout = opts.wrongAttemptsBeforeLockout;
    this.lockoutMs = opts.lockoutMs;
    this.now = opts.now ?? Date.now;
  }

  check(ip: string): CheckResult {
    const now = this.now();

    const lockedUntil = this.lockedUntil.get(ip);
    if (lockedUntil !== undefined) {
      if (now < lockedUntil) return { allowed: false, reason: "rate_limited" };
      this.lockedUntil.delete(ip);
      this.wrongCounts.delete(ip);
    }

    const recent = this.recentAttempts(ip, now);
    if (recent.length >= this.perMinute) {
      return { allowed: false, reason: "rate_limited" };
    }
    recent.push(now);
    this.attempts.set(ip, recent);
    return { allowed: true };
  }

  recordWrong(ip: string): void {
    const next = (this.wrongCounts.get(ip) ?? 0) + 1;
    this.wrongCounts.set(ip, next);
    if (next >= this.wrongAttemptsBeforeLockout) {
      this.lockedUntil.set(ip, this.now() + this.lockoutMs);
    }
  }

  recordSuccess(ip: string): void {
    this.wrongCounts.delete(ip);
    this.lockedUntil.delete(ip);
  }

  private recentAttempts(ip: string, now: number): number[] {
    const all = this.attempts.get(ip) ?? [];
    const cutoff = now - WINDOW_MS;
    return all.filter((t) => t > cutoff);
  }
}
