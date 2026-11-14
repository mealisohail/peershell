import { test } from "node:test";
import assert from "node:assert/strict";
import { RateLimiter } from "./rate-limit.ts";

function fakeClock(start = 0) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const opts = (now: () => number) => ({
  perMinute: 5,
  wrongAttemptsBeforeLockout: 3,
  lockoutMs: 60_000,
  now,
});

test("allows up to perMinute attempts per IP", () => {
  const clock = fakeClock();
  const rl = new RateLimiter(opts(clock.now));
  for (let i = 0; i < 5; i++) {
    assert.equal(rl.check("1.1.1.1").allowed, true, `attempt ${i + 1}`);
  }
});

test("rejects the (perMinute+1)th attempt with rate_limited", () => {
  const clock = fakeClock();
  const rl = new RateLimiter(opts(clock.now));
  for (let i = 0; i < 5; i++) rl.check("1.1.1.1");
  const result = rl.check("1.1.1.1");
  assert.equal(result.allowed, false);
  if (result.allowed) return;
  assert.equal(result.reason, "rate_limited");
});

test("window slides — attempts older than 60s do not count", () => {
  const clock = fakeClock();
  const rl = new RateLimiter(opts(clock.now));
  for (let i = 0; i < 5; i++) rl.check("1.1.1.1");
  assert.equal(rl.check("1.1.1.1").allowed, false);
  clock.advance(60_001);
  assert.equal(rl.check("1.1.1.1").allowed, true);
});

test("separate IPs are tracked independently", () => {
  const clock = fakeClock();
  const rl = new RateLimiter(opts(clock.now));
  for (let i = 0; i < 5; i++) rl.check("1.1.1.1");
  assert.equal(rl.check("2.2.2.2").allowed, true);
});

test("recordWrong locks IP after threshold and reports lockout reason", () => {
  const clock = fakeClock();
  const rl = new RateLimiter(opts(clock.now));
  rl.recordWrong("1.1.1.1");
  rl.recordWrong("1.1.1.1");
  assert.equal(rl.check("1.1.1.1").allowed, true);
  rl.recordWrong("1.1.1.1");
  const result = rl.check("1.1.1.1");
  assert.equal(result.allowed, false);
  if (result.allowed) return;
  assert.equal(result.reason, "rate_limited");
});

test("lockout expires after lockoutMs", () => {
  const clock = fakeClock();
  const rl = new RateLimiter(opts(clock.now));
  rl.recordWrong("1.1.1.1");
  rl.recordWrong("1.1.1.1");
  rl.recordWrong("1.1.1.1");
  assert.equal(rl.check("1.1.1.1").allowed, false);
  clock.advance(60_001);
  assert.equal(rl.check("1.1.1.1").allowed, true);
});

test("recordSuccess resets wrong-attempt counter", () => {
  const clock = fakeClock();
  const rl = new RateLimiter(opts(clock.now));
  rl.recordWrong("1.1.1.1");
  rl.recordWrong("1.1.1.1");
  rl.recordSuccess("1.1.1.1");
  rl.recordWrong("1.1.1.1");
  rl.recordWrong("1.1.1.1");
  assert.equal(rl.check("1.1.1.1").allowed, true);
});
