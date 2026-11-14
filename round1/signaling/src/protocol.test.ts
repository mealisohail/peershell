import { test } from "node:test";
import assert from "node:assert/strict";
import { parseClientMessage } from "./protocol.ts";

test("parses agent register message", () => {
  const result = parseClientMessage(
    JSON.stringify({
      type: "register",
      role: "agent",
      code: "483291",
      hostname: "machine.local",
    }),
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.message.type, "register");
});

test("parses viewer connect message", () => {
  const result = parseClientMessage(
    JSON.stringify({ type: "connect", role: "viewer", code: "483291" }),
  );
  assert.equal(result.ok, true);
});

test("parses peer-offer with sdp", () => {
  const result = parseClientMessage(
    JSON.stringify({
      type: "peer-offer",
      code: "483291",
      sdp: { type: "offer", sdp: "v=0..." },
    }),
  );
  assert.equal(result.ok, true);
});

test("parses peer-answer with sdp", () => {
  const result = parseClientMessage(
    JSON.stringify({
      type: "peer-answer",
      code: "483291",
      sdp: { type: "answer", sdp: "v=0..." },
    }),
  );
  assert.equal(result.ok, true);
});

test("parses ice-candidate with target", () => {
  const result = parseClientMessage(
    JSON.stringify({
      type: "ice-candidate",
      code: "483291",
      candidate: { candidate: "candidate:...", sdpMid: "0", sdpMLineIndex: 0 },
      target: "viewer",
    }),
  );
  assert.equal(result.ok, true);
});

test("parses unregister message", () => {
  const result = parseClientMessage(
    JSON.stringify({ type: "unregister", code: "483291" }),
  );
  assert.equal(result.ok, true);
});

test("rejects non-json", () => {
  const result = parseClientMessage("not-json");
  assert.equal(result.ok, false);
});

test("rejects message without type", () => {
  const result = parseClientMessage(JSON.stringify({ code: "1" }));
  assert.equal(result.ok, false);
});

test("rejects unknown type", () => {
  const result = parseClientMessage(
    JSON.stringify({ type: "nuke", code: "1" }),
  );
  assert.equal(result.ok, false);
});

test("rejects register with non-6-digit code", () => {
  const result = parseClientMessage(
    JSON.stringify({
      type: "register",
      role: "agent",
      code: "abc",
      hostname: "h",
    }),
  );
  assert.equal(result.ok, false);
});

test("rejects register with wrong role", () => {
  const result = parseClientMessage(
    JSON.stringify({
      type: "register",
      role: "viewer",
      code: "123456",
      hostname: "h",
    }),
  );
  assert.equal(result.ok, false);
});

test("rejects ice-candidate with invalid target", () => {
  const result = parseClientMessage(
    JSON.stringify({
      type: "ice-candidate",
      code: "123456",
      candidate: {},
      target: "alien",
    }),
  );
  assert.equal(result.ok, false);
});

test("rejects peer-offer with missing sdp", () => {
  const result = parseClientMessage(
    JSON.stringify({ type: "peer-offer", code: "123456" }),
  );
  assert.equal(result.ok, false);
});
