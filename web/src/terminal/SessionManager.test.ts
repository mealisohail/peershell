import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionManager } from "./SessionManager.ts";

/**
 * Test scheduler: queues callbacks instead of firing them; tests advance time
 * explicitly via flushAll(). Lets us verify both "fires when uncancelled"
 * and "cancelled when re-attached within grace window".
 */
function makeFakeScheduler() {
  type Pending = { id: number; fn: () => void };
  const queue: Pending[] = [];
  let nextId = 1;
  return {
    schedule: (_ms: number, fn: () => void) => {
      const id = nextId++;
      queue.push({ id, fn });
      return id;
    },
    cancel: (id: number) => {
      const idx = queue.findIndex((p) => p.id === id);
      if (idx >= 0) queue.splice(idx, 1);
    },
    flushAll() {
      const drained = queue.splice(0);
      for (const p of drained) p.fn();
    },
    queueSize() {
      return queue.length;
    },
  };
}

test("create() returns a new session indexed by its generated id", () => {
  const m = new SessionManager();
  const s = m.create({ pairingCode: "123456" });
  assert.equal(s.pairingCode, "123456");
  assert.equal(m.get(s.id), s);
  assert.equal(m.list().length, 1);
});

test("attach increments the session refcount; detach decrements", () => {
  const m = new SessionManager();
  const s = m.create({ pairingCode: "123456" });
  m.attach(s.id, "tab-a");
  m.attach(s.id, "tab-b");
  assert.equal(s.refCount, 2);
  m.detach(s.id, "tab-a");
  assert.equal(s.refCount, 1);
});

test("detach to zero schedules a dispose; grace period delays it", () => {
  const sched = makeFakeScheduler();
  const m = new SessionManager({
    graceMs: 5000,
    schedule: sched.schedule,
    cancel: sched.cancel,
  });
  const s = m.create({ pairingCode: "123456" });
  m.attach(s.id, "tab-a");
  m.detach(s.id, "tab-a");
  // Not disposed yet — sitting in the scheduler queue.
  assert.equal(m.get(s.id), s);
  assert.equal(sched.queueSize(), 1);
  // Fire the timer.
  sched.flushAll();
  assert.equal(m.get(s.id), null);
});

test("re-attach within grace cancels the pending dispose", () => {
  const sched = makeFakeScheduler();
  const m = new SessionManager({
    graceMs: 5000,
    schedule: sched.schedule,
    cancel: sched.cancel,
  });
  const s = m.create({ pairingCode: "123456" });
  m.attach(s.id, "tab-a");
  m.detach(s.id, "tab-a");
  assert.equal(sched.queueSize(), 1);
  m.attach(s.id, "tab-b");
  assert.equal(sched.queueSize(), 0);
  sched.flushAll();
  assert.equal(m.get(s.id), s);
});

test("onBeforeDispose fires before the session is removed from the manager", () => {
  const sched = makeFakeScheduler();
  const m = new SessionManager({
    graceMs: 5000,
    schedule: sched.schedule,
    cancel: sched.cancel,
  });
  const s = m.create({ pairingCode: "123456" });
  m.attach(s.id, "tab-a");

  let disposedId = "";
  let stillRegistered: unknown = null;
  m.onBeforeDispose((session) => {
    disposedId = session.id;
    // Manager should still have it accessible when the hook fires.
    stillRegistered = m.get(session.id);
  });

  m.detach(s.id, "tab-a");
  sched.flushAll();
  assert.equal(disposedId, s.id);
  assert.equal(stillRegistered, s);
  // After the hook returns, the manager removes it.
  assert.equal(m.get(s.id), null);
});

test("disposeNow short-circuits the grace period", () => {
  const sched = makeFakeScheduler();
  const m = new SessionManager({
    graceMs: 5000,
    schedule: sched.schedule,
    cancel: sched.cancel,
  });
  const s = m.create({ pairingCode: "123456" });
  m.attach(s.id, "tab-a");
  m.detach(s.id, "tab-a");
  assert.equal(sched.queueSize(), 1);
  m.disposeNow(s.id);
  assert.equal(m.get(s.id), null);
  assert.equal(sched.queueSize(), 0);
});

test("two pairings produce two independent sessions with different ids", () => {
  const m = new SessionManager();
  const a = m.create({ pairingCode: "111111" });
  const b = m.create({ pairingCode: "222222" });
  assert.notEqual(a.id, b.id);
  assert.equal(m.list().length, 2);
});
