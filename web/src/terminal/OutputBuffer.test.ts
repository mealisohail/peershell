import { test } from "node:test";
import assert from "node:assert/strict";
import { OutputBuffer } from "./OutputBuffer.ts";

function bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function decode(u: Uint8Array): string {
  return new TextDecoder().decode(u);
}

test("append + snapshot returns what was appended", () => {
  const b = new OutputBuffer(1024);
  b.append(bytes("hello "));
  b.append(bytes("world"));
  assert.equal(decode(b.snapshot()), "hello world");
});

test("byteSize reflects current contents", () => {
  const b = new OutputBuffer(1024);
  assert.equal(b.byteSize(), 0);
  b.append(bytes("hi"));
  assert.equal(b.byteSize(), 2);
});

test("evicts oldest bytes once over capacity", () => {
  const b = new OutputBuffer(10);
  b.append(bytes("0123456789")); // exactly fills
  assert.equal(decode(b.snapshot()), "0123456789");
  b.append(bytes("ABC")); // overflows by 3
  // Oldest 3 bytes (`012`) should be evicted
  assert.equal(decode(b.snapshot()), "3456789ABC");
  assert.equal(b.byteSize(), 10);
});

test("snapshot is a copy — caller cannot mutate the buffer", () => {
  const b = new OutputBuffer(64);
  b.append(bytes("abc"));
  const s = b.snapshot();
  s[0] = 0;
  assert.equal(decode(b.snapshot()), "abc");
});

test("clear empties the buffer", () => {
  const b = new OutputBuffer(64);
  b.append(bytes("data"));
  b.clear();
  assert.equal(b.byteSize(), 0);
  assert.equal(b.snapshot().length, 0);
});

test("handles a single chunk larger than capacity by keeping only the tail", () => {
  const b = new OutputBuffer(5);
  b.append(bytes("ABCDEFGHIJ")); // 10 bytes into a 5-byte buffer
  assert.equal(decode(b.snapshot()), "FGHIJ");
  assert.equal(b.byteSize(), 5);
});

test("rejects non-positive capacity", () => {
  assert.throws(() => new OutputBuffer(0));
  assert.throws(() => new OutputBuffer(-1));
});
