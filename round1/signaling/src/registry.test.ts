import { test } from "node:test";
import assert from "node:assert/strict";
import { Registry } from "./registry.ts";

type FakeAgent = { id: number };

function fakeClock(start = 0) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test("register stores agent retrievable by code", () => {
  const reg = new Registry<FakeAgent>({ ttlMs: 60_000 });
  const result = reg.register("123456", { id: 1 });
  assert.equal(result.ok, true);
  assert.deepEqual(reg.lookup("123456"), { id: 1 });
});

test("register rejects duplicate code", () => {
  const reg = new Registry<FakeAgent>({ ttlMs: 60_000 });
  reg.register("123456", { id: 1 });
  const result = reg.register("123456", { id: 2 });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "duplicate_code");
  assert.deepEqual(reg.lookup("123456"), { id: 1 });
});

test("lookup returns undefined for unknown code", () => {
  const reg = new Registry<FakeAgent>({ ttlMs: 60_000 });
  assert.equal(reg.lookup("999999"), undefined);
});

test("unregister removes the code", () => {
  const reg = new Registry<FakeAgent>({ ttlMs: 60_000 });
  reg.register("123456", { id: 1 });
  reg.unregister("123456");
  assert.equal(reg.lookup("123456"), undefined);
});

test("pair invalidates the code (single-use)", () => {
  const reg = new Registry<FakeAgent>({ ttlMs: 60_000 });
  reg.register("123456", { id: 1 });
  const paired = reg.pair("123456");
  assert.equal(paired, true);
  assert.equal(reg.lookup("123456"), undefined);
});

test("pair returns false for unknown code", () => {
  const reg = new Registry<FakeAgent>({ ttlMs: 60_000 });
  assert.equal(reg.pair("123456"), false);
});

test("lookup returns undefined after ttl", () => {
  const clock = fakeClock();
  const reg = new Registry<FakeAgent>({ ttlMs: 1000, now: clock.now });
  reg.register("123456", { id: 1 });
  clock.advance(999);
  assert.deepEqual(reg.lookup("123456"), { id: 1 });
  clock.advance(2);
  assert.equal(reg.lookup("123456"), undefined);
});

test("cleanup removes expired entries and returns count", () => {
  const clock = fakeClock();
  const reg = new Registry<FakeAgent>({ ttlMs: 1000, now: clock.now });
  reg.register("111111", { id: 1 });
  reg.register("222222", { id: 2 });
  clock.advance(1001);
  reg.register("333333", { id: 3 });
  const removed = reg.cleanup();
  assert.equal(removed, 2);
  assert.equal(reg.lookup("111111"), undefined);
  assert.equal(reg.lookup("222222"), undefined);
  assert.deepEqual(reg.lookup("333333"), { id: 3 });
});

test("size reports active (non-expired) entries", () => {
  const clock = fakeClock();
  const reg = new Registry<FakeAgent>({ ttlMs: 1000, now: clock.now });
  reg.register("111111", { id: 1 });
  reg.register("222222", { id: 2 });
  assert.equal(reg.size(), 2);
  clock.advance(2000);
  assert.equal(reg.size(), 0);
});

test("re-register works after unregister", () => {
  const reg = new Registry<FakeAgent>({ ttlMs: 60_000 });
  reg.register("123456", { id: 1 });
  reg.unregister("123456");
  const result = reg.register("123456", { id: 2 });
  assert.equal(result.ok, true);
  assert.deepEqual(reg.lookup("123456"), { id: 2 });
});

test("re-register works after pair", () => {
  const reg = new Registry<FakeAgent>({ ttlMs: 60_000 });
  reg.register("123456", { id: 1 });
  reg.pair("123456");
  const result = reg.register("123456", { id: 2 });
  assert.equal(result.ok, true);
});
