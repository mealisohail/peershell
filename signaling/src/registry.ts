// In-memory registry mapping pairing code → connected agent.
// One agent per code. Codes are single-use: `pair()` removes them so a second
// viewer cannot reuse the same code. TTL evicts inactive registrations.

export type RegisterResult =
  | { ok: true }
  | { ok: false; reason: "duplicate_code" };

type Entry<T> = {
  agent: T;
  expiresAt: number;
};

export type RegistryOptions = {
  ttlMs: number;
  now?: () => number;
};

export class Registry<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(opts: RegistryOptions) {
    this.ttlMs = opts.ttlMs;
    this.now = opts.now ?? Date.now;
  }

  register(code: string, agent: T): RegisterResult {
    if (this.isLive(code)) return { ok: false, reason: "duplicate_code" };
    this.entries.set(code, { agent, expiresAt: this.now() + this.ttlMs });
    return { ok: true };
  }

  lookup(code: string): T | undefined {
    const entry = this.entries.get(code);
    if (!entry) return undefined;
    if (this.now() >= entry.expiresAt) {
      this.entries.delete(code);
      return undefined;
    }
    return entry.agent;
  }

  pair(code: string): boolean {
    if (!this.isLive(code)) return false;
    this.entries.delete(code);
    return true;
  }

  unregister(code: string): void {
    this.entries.delete(code);
  }

  size(): number {
    this.cleanup();
    return this.entries.size;
  }

  cleanup(): number {
    const now = this.now();
    let removed = 0;
    for (const [code, entry] of this.entries) {
      if (now >= entry.expiresAt) {
        this.entries.delete(code);
        removed++;
      }
    }
    return removed;
  }

  private isLive(code: string): boolean {
    return this.lookup(code) !== undefined;
  }
}
