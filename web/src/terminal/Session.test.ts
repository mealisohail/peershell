import { test } from "node:test";
import assert from "node:assert/strict";
import { Session } from "./Session.ts";

function bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

test("new session starts at status=pairing, refCount=0, no focus owner", () => {
  const s = new Session({ id: "s1", pairingCode: "123456" });
  assert.equal(s.id, "s1");
  assert.equal(s.pairingCode, "123456");
  assert.equal(s.status, "pairing");
  assert.equal(s.refCount, 0);
  assert.equal(s.focusedAttachmentId, null);
  assert.equal(s.outputBuffer.byteSize(), 0);
});

test("attach increments refCount and stamps the first owner as focused", () => {
  const s = new Session({ id: "s1", pairingCode: "111111" });
  s.attach("tab-a");
  assert.equal(s.refCount, 1);
  assert.equal(s.focusedAttachmentId, "tab-a");
  s.attach("tab-b");
  assert.equal(s.refCount, 2);
  // Focus stays with the first attachment until something explicitly takes it.
  assert.equal(s.focusedAttachmentId, "tab-a");
});

test("detach decrements refCount and clears focus when the focused owner detaches", () => {
  const s = new Session({ id: "s1", pairingCode: "111111" });
  s.attach("tab-a");
  s.attach("tab-b");
  s.detach("tab-a");
  assert.equal(s.refCount, 1);
  // Focus owner went away; ownership transfers to the next remaining owner.
  assert.equal(s.focusedAttachmentId, "tab-b");
  s.detach("tab-b");
  assert.equal(s.refCount, 0);
  assert.equal(s.focusedAttachmentId, null);
  assert.equal(s.isOrphan(), true);
});

test("setFocus transfers ownership atomically", () => {
  const s = new Session({ id: "s1", pairingCode: "111111" });
  s.attach("a");
  s.attach("b");
  s.setFocus("b");
  assert.equal(s.focusedAttachmentId, "b");
});

test("setFocus to an unattached id throws", () => {
  const s = new Session({ id: "s1", pairingCode: "111111" });
  s.attach("a");
  assert.throws(() => s.setFocus("ghost"));
});

test("setStatus emits to onStatusChange listeners", () => {
  const s = new Session({ id: "s1", pairingCode: "111111" });
  const seen: string[] = [];
  s.onStatusChange((status) => seen.push(status));
  s.setStatus("connecting");
  s.setStatus("connected");
  assert.deepEqual(seen, ["connecting", "connected"]);
});

test("appendOutput writes to the buffer and notifies onOutput listeners", () => {
  const s = new Session({ id: "s1", pairingCode: "111111" });
  const received: string[] = [];
  s.onOutput((chunk) => received.push(new TextDecoder().decode(chunk)));
  s.appendOutput(bytes("ls\n"));
  s.appendOutput(bytes("foo bar\n"));
  assert.deepEqual(received, ["ls\n", "foo bar\n"]);
  assert.equal(s.outputBuffer.byteSize(), "ls\nfoo bar\n".length);
});

test("listeners can be removed", () => {
  const s = new Session({ id: "s1", pairingCode: "111111" });
  let count = 0;
  const unsub = s.onOutput(() => count++);
  s.appendOutput(bytes("a"));
  unsub();
  s.appendOutput(bytes("b"));
  assert.equal(count, 1);
});

test("detach on an unattached id is a no-op", () => {
  const s = new Session({ id: "s1", pairingCode: "111111" });
  s.attach("a");
  s.detach("not-attached"); // ignored
  assert.equal(s.refCount, 1);
  assert.equal(s.focusedAttachmentId, "a");
});

test("hostname can be set after construction", () => {
  const s = new Session({ id: "s1", pairingCode: "111111" });
  assert.equal(s.hostname, null);
  s.setHostname("MacBook-Pro");
  assert.equal(s.hostname, "MacBook-Pro");
});
