import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SignalingClient,
  type ServerMessage,
  type WebSocketLike,
} from "./signaling.ts";

type AnyListener = (arg?: unknown) => void;

class FakeSocket implements WebSocketLike {
  static instances: FakeSocket[] = [];

  readyState = 0; // CONNECTING
  sent: string[] = [];
  private listeners = new Map<string, AnyListener[]>();

  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.emit("close");
  }

  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "close", listener: () => void): void;
  addEventListener(
    type: "message",
    listener: (event: { data: unknown }) => void,
  ): void;
  addEventListener(type: "error", listener: () => void): void;
  addEventListener(
    type: string,
    listener: ((event: { data: unknown }) => void) | (() => void),
  ): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(listener as AnyListener);
    this.listeners.set(type, arr);
  }

  // Test helpers
  open(): void {
    this.readyState = 1;
    this.emit("open");
  }

  deliver(msg: ServerMessage | string): void {
    const data = typeof msg === "string" ? msg : JSON.stringify(msg);
    this.emit("message", { data });
  }

  errorOut(): void {
    this.emit("error");
  }

  private emit(type: string, payload?: unknown): void {
    const arr = this.listeners.get(type) ?? [];
    for (const l of arr) l(payload);
  }
}

function factory(url: string): WebSocketLike {
  return new FakeSocket(url);
}

function lastSocket(): FakeSocket {
  const s = FakeSocket.instances.at(-1);
  if (!s) throw new Error("no fake socket created");
  return s;
}

test("connect resolves when underlying socket opens", async () => {
  FakeSocket.instances = [];
  const client = new SignalingClient({
    url: "ws://example/ws",
    wsFactory: factory,
  });
  const p = client.connect();
  lastSocket().open();
  await p;
});

test("connect rejects when socket errors before open", async () => {
  FakeSocket.instances = [];
  const client = new SignalingClient({
    url: "ws://example/ws",
    wsFactory: factory,
  });
  const p = client.connect();
  lastSocket().errorOut();
  await assert.rejects(p);
});

test("sendConnect emits the correct wire shape", async () => {
  FakeSocket.instances = [];
  const client = new SignalingClient({
    url: "ws://example/ws",
    wsFactory: factory,
  });
  const p = client.connect();
  lastSocket().open();
  await p;
  client.sendConnect("123456");
  assert.equal(lastSocket().sent.length, 1);
  assert.deepEqual(JSON.parse(lastSocket().sent[0]!), {
    type: "connect",
    role: "viewer",
    code: "123456",
  });
});

test("onMessage receives parsed agent-ready", async () => {
  FakeSocket.instances = [];
  const client = new SignalingClient({
    url: "ws://example/ws",
    wsFactory: factory,
  });
  const received: ServerMessage[] = [];
  client.onMessage((m) => received.push(m));
  const p = client.connect();
  lastSocket().open();
  await p;
  lastSocket().deliver({ type: "agent-ready", code: "123456" });
  assert.equal(received.length, 1);
  assert.equal(received[0]?.type, "agent-ready");
});

test("onMessage ignores non-JSON frames without crashing", async () => {
  FakeSocket.instances = [];
  const client = new SignalingClient({
    url: "ws://example/ws",
    wsFactory: factory,
  });
  const received: ServerMessage[] = [];
  client.onMessage((m) => received.push(m));
  const p = client.connect();
  lastSocket().open();
  await p;
  lastSocket().deliver("not-json");
  assert.equal(received.length, 0);
});

test("onMessage drops messages with unknown types", async () => {
  FakeSocket.instances = [];
  const client = new SignalingClient({
    url: "ws://example/ws",
    wsFactory: factory,
  });
  const received: ServerMessage[] = [];
  client.onMessage((m) => received.push(m));
  const p = client.connect();
  lastSocket().open();
  await p;
  lastSocket().deliver({ type: "bogus", code: "1" } as never);
  assert.equal(received.length, 0);
});

test("sendPeerOffer emits the correct wire shape", async () => {
  FakeSocket.instances = [];
  const client = new SignalingClient({
    url: "ws://example/ws",
    wsFactory: factory,
  });
  const p = client.connect();
  lastSocket().open();
  await p;
  client.sendPeerOffer("123456", { type: "offer", sdp: "v=0..." });
  assert.deepEqual(JSON.parse(lastSocket().sent[0]!), {
    type: "peer-offer",
    code: "123456",
    sdp: { type: "offer", sdp: "v=0..." },
  });
});

test("sendIceCandidate targets the agent", async () => {
  FakeSocket.instances = [];
  const client = new SignalingClient({
    url: "ws://example/ws",
    wsFactory: factory,
  });
  const p = client.connect();
  lastSocket().open();
  await p;
  client.sendIceCandidate("123456", {
    candidate: "candidate:1",
    sdpMid: "0",
    sdpMLineIndex: 0,
  });
  assert.deepEqual(JSON.parse(lastSocket().sent[0]!), {
    type: "ice-candidate",
    code: "123456",
    candidate: { candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0 },
    target: "agent",
  });
});

test("status callback fires open and closed", async () => {
  FakeSocket.instances = [];
  const client = new SignalingClient({
    url: "ws://example/ws",
    wsFactory: factory,
  });
  const statuses: string[] = [];
  client.onStatus((s) => statuses.push(s));
  const p = client.connect();
  assert.deepEqual(statuses, ["connecting"]);
  lastSocket().open();
  await p;
  assert.deepEqual(statuses, ["connecting", "open"]);
  lastSocket().close();
  assert.deepEqual(statuses, ["connecting", "open", "closed"]);
});

test("close() invokes underlying socket close", async () => {
  FakeSocket.instances = [];
  const client = new SignalingClient({
    url: "ws://example/ws",
    wsFactory: factory,
  });
  const p = client.connect();
  lastSocket().open();
  await p;
  client.close();
  assert.equal(lastSocket().readyState, 3);
});
