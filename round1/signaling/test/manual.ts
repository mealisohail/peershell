// Phase 1 verification per PRD §10.
//
// Spins up the signaling server in-process, simulates one agent + one viewer
// over real WebSockets, exchanges a fake SDP offer/answer + ICE candidate,
// and confirms the relay works. Exits 0 on success, 1 on any assertion fail.
//
// Run with: npm run test:manual

import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
import http from "node:http";
import WebSocket from "ws";
import { startServer } from "../src/server.ts";

const PORT = 9999;
const URL = `ws://127.0.0.1:${PORT}/ws`;
const HEALTH = `http://127.0.0.1:${PORT}/health`;
const CODE = "483291";

type Msg = Record<string, unknown>;

function connect(name: string): {
  socket: WebSocket;
  inbox: Msg[];
  next(timeoutMs?: number): Promise<Msg>;
} {
  const socket = new WebSocket(URL);
  const inbox: Msg[] = [];
  const waiters: Array<(m: Msg) => void> = [];
  socket.on("message", (data) => {
    const msg = JSON.parse(data.toString()) as Msg;
    const w = waiters.shift();
    if (w) w(msg);
    else inbox.push(msg);
  });
  socket.on("error", (err) => console.error(`[${name}] ws error`, err));
  return {
    socket,
    inbox,
    next: (timeoutMs = 2000) =>
      new Promise<Msg>((resolve, reject) => {
        const queued = inbox.shift();
        if (queued) return resolve(queued);
        const t = setTimeout(
          () => reject(new Error(`[${name}] timed out waiting for message`)),
          timeoutMs,
        );
        waiters.push((m) => {
          clearTimeout(t);
          resolve(m);
        });
      }),
  };
}

function waitOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

function httpGet(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      })
      .on("error", reject);
  });
}

async function main(): Promise<void> {
  console.log("[manual] starting server on", PORT);
  const server = await startServer({
    port: PORT,
    codeTtlMs: 60_000,
    ratePerMinute: 5,
    wrongAttemptsBeforeLockout: 3,
    lockoutMs: 60_000,
  });

  try {
    // /health ----------------------------------------------------------------
    const health = await httpGet(HEALTH);
    assert.equal(health.status, 200, "/health returned non-200");
    assert.equal(JSON.parse(health.body).status, "ok");
    console.log("[manual] /health OK");

    // Agent connects + registers ---------------------------------------------
    const agent = connect("agent");
    await waitOpen(agent.socket);
    agent.socket.send(
      JSON.stringify({
        type: "register",
        role: "agent",
        code: CODE,
        hostname: "test-host",
      }),
    );
    const registered = await agent.next();
    assert.equal(registered["type"], "registered");
    assert.equal(registered["code"], CODE);
    console.log("[manual] agent registered");

    // Wrong code → code_not_found, and wrong counter rises -------------------
    const guesser = connect("guesser");
    await waitOpen(guesser.socket);
    guesser.socket.send(
      JSON.stringify({ type: "connect", role: "viewer", code: "999999" }),
    );
    const guessErr = await guesser.next();
    assert.equal(guessErr["type"], "error");
    assert.equal(guessErr["reason"], "code_not_found");
    guesser.socket.close();
    console.log("[manual] wrong code rejected with code_not_found");

    // Viewer connects with right code ---------------------------------------
    const viewer = connect("viewer");
    await waitOpen(viewer.socket);
    viewer.socket.send(
      JSON.stringify({ type: "connect", role: "viewer", code: CODE }),
    );
    const agentReady = await viewer.next();
    assert.equal(agentReady["type"], "agent-ready");
    const viewerConnecting = await agent.next();
    assert.equal(viewerConnecting["type"], "viewer-connecting");
    console.log("[manual] viewer paired with agent");

    // Viewer → server → agent: peer-offer ------------------------------------
    const fakeOffer = { type: "offer" as const, sdp: "v=0\r\n...fake-offer\r\n" };
    viewer.socket.send(
      JSON.stringify({ type: "peer-offer", code: CODE, sdp: fakeOffer }),
    );
    const offerOnAgent = await agent.next();
    assert.equal(offerOnAgent["type"], "peer-offer");
    assert.deepEqual(offerOnAgent["sdp"], fakeOffer);
    console.log("[manual] peer-offer relayed");

    // Agent → server → viewer: peer-answer -----------------------------------
    const fakeAnswer = { type: "answer" as const, sdp: "v=0\r\n...fake-answer\r\n" };
    agent.socket.send(
      JSON.stringify({ type: "peer-answer", code: CODE, sdp: fakeAnswer }),
    );
    const answerOnViewer = await viewer.next();
    assert.equal(answerOnViewer["type"], "peer-answer");
    assert.deepEqual(answerOnViewer["sdp"], fakeAnswer);
    console.log("[manual] peer-answer relayed");

    // ICE candidates both ways -----------------------------------------------
    const cand1 = { candidate: "candidate:1 udp ...", sdpMid: "0", sdpMLineIndex: 0 };
    viewer.socket.send(
      JSON.stringify({
        type: "ice-candidate",
        code: CODE,
        candidate: cand1,
        target: "agent",
      }),
    );
    const candOnAgent = await agent.next();
    assert.equal(candOnAgent["type"], "ice-candidate");
    assert.deepEqual(candOnAgent["candidate"], cand1);

    const cand2 = { candidate: "candidate:2 udp ...", sdpMid: "0", sdpMLineIndex: 0 };
    agent.socket.send(
      JSON.stringify({
        type: "ice-candidate",
        code: CODE,
        candidate: cand2,
        target: "viewer",
      }),
    );
    const candOnViewer = await viewer.next();
    assert.equal(candOnViewer["type"], "ice-candidate");
    assert.deepEqual(candOnViewer["candidate"], cand2);
    console.log("[manual] ICE candidates relayed both ways");

    // Second viewer can't reuse the now-consumed code ------------------------
    const second = connect("second-viewer");
    await waitOpen(second.socket);
    second.socket.send(
      JSON.stringify({ type: "connect", role: "viewer", code: CODE }),
    );
    const secondErr = await second.next();
    assert.equal(secondErr["type"], "error");
    assert.equal(secondErr["reason"], "code_not_found");
    second.socket.close();
    console.log("[manual] second viewer rejected (single-use)");

    // Duplicate register --------------------------------------------------------
    const dupAgent = connect("dup-agent");
    await waitOpen(dupAgent.socket);
    // Register a second agent under a fresh code, then try to dup it.
    const otherCode = "111222";
    dupAgent.socket.send(
      JSON.stringify({
        type: "register",
        role: "agent",
        code: otherCode,
        hostname: "h",
      }),
    );
    await dupAgent.next();
    const dupAgent2 = connect("dup-agent-2");
    await waitOpen(dupAgent2.socket);
    dupAgent2.socket.send(
      JSON.stringify({
        type: "register",
        role: "agent",
        code: otherCode,
        hostname: "h",
      }),
    );
    const dupErr = await dupAgent2.next();
    assert.equal(dupErr["type"], "error");
    assert.equal(dupErr["reason"], "duplicate_code");
    dupAgent.socket.close();
    dupAgent2.socket.close();
    console.log("[manual] duplicate registration rejected");

    // Cleanup
    agent.socket.close();
    viewer.socket.close();
    await delay(50);

    console.log("\n[manual] ✔ all assertions passed");
  } finally {
    await server.close();
  }
}

main().catch((err) => {
  console.error("[manual] ✘", err);
  process.exit(1);
});
