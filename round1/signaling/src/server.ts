import http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { parseClientMessage } from "./protocol.ts";
import type {
  ClientMessage,
  ServerToAgent,
  ServerToViewer,
  ErrorReason,
} from "./protocol.ts";
import { Registry } from "./registry.ts";
import { RateLimiter } from "./rate-limit.ts";
import { log } from "./logger.ts";

export type ServerConfig = {
  port: number;
  codeTtlMs: number;
  ratePerMinute: number;
  wrongAttemptsBeforeLockout: number;
  lockoutMs: number;
};

type AgentConn = {
  role: "agent";
  socket: WebSocket;
  code: string;
  hostname: string;
  mode: "full" | "view-only";
};

type ViewerConn = {
  role: "viewer";
  socket: WebSocket;
  code: string;
  ip: string;
};

type Pairing = {
  code: string;
  agent: AgentConn;
  viewer: ViewerConn;
};

export type RunningServer = {
  http: http.Server;
  ws: WebSocketServer;
  registry: Registry<AgentConn>;
  close: () => Promise<void>;
};

export function startServer(cfg: ServerConfig): Promise<RunningServer> {
  const registry = new Registry<AgentConn>({ ttlMs: cfg.codeTtlMs });
  const rateLimiter = new RateLimiter({
    perMinute: cfg.ratePerMinute,
    wrongAttemptsBeforeLockout: cfg.wrongAttemptsBeforeLockout,
    lockoutMs: cfg.lockoutMs,
  });
  const pairings = new Map<string, Pairing>();
  const socketState = new WeakMap<WebSocket, AgentConn | ViewerConn>();

  const httpServer = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  const sweep = setInterval(() => {
    const removed = registry.cleanup();
    if (removed > 0) log.debug("registry cleanup", { removed });
  }, 30_000);
  sweep.unref();

  function sendTo(
    socket: WebSocket,
    msg: ServerToAgent | ServerToViewer,
  ): void {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(msg));
    }
  }

  function sendError(socket: WebSocket, reason: ErrorReason): void {
    sendTo(socket, { type: "error", reason });
  }

  function handleMessage(
    socket: WebSocket,
    ip: string,
    raw: string,
  ): void {
    const parsed = parseClientMessage(raw);
    if (!parsed.ok) {
      log.warn("invalid message", { ip, reason: parsed.reason });
      sendError(socket, "invalid_message");
      return;
    }
    dispatch(socket, ip, parsed.message);
  }

  function dispatch(
    socket: WebSocket,
    ip: string,
    msg: ClientMessage,
  ): void {
    switch (msg.type) {
      case "register":
        handleRegister(socket, msg.code, msg.hostname, msg.mode ?? "full");
        return;
      case "connect":
        handleConnect(socket, ip, msg.code);
        return;
      case "peer-offer":
        forwardOffer(socket, msg.code, msg.sdp);
        return;
      case "peer-answer":
        forwardAnswer(socket, msg.code, msg.sdp);
        return;
      case "ice-candidate":
        forwardIce(socket, msg.code, msg.candidate, msg.target);
        return;
      case "unregister":
        handleUnregister(socket, msg.code);
        return;
    }
  }

  function handleRegister(
    socket: WebSocket,
    code: string,
    hostname: string,
    mode: "full" | "view-only",
  ): void {
    const existing = socketState.get(socket);
    if (existing) {
      sendError(socket, "invalid_message");
      return;
    }
    const agent: AgentConn = { role: "agent", socket, code, hostname, mode };
    const result = registry.register(code, agent);
    if (!result.ok) {
      sendError(socket, "duplicate_code");
      return;
    }
    socketState.set(socket, agent);
    log.info("agent registered", { code, hostname, mode });
    sendTo(socket, { type: "registered", code });
  }

  function handleConnect(socket: WebSocket, ip: string, code: string): void {
    const gate = rateLimiter.check(ip);
    if (!gate.allowed) {
      log.warn("rate limited", { ip, code });
      sendError(socket, "rate_limited");
      return;
    }
    const agent = registry.lookup(code);
    if (!agent) {
      rateLimiter.recordWrong(ip);
      sendError(socket, "code_not_found");
      return;
    }
    if (!registry.pair(code)) {
      sendError(socket, "code_not_found");
      return;
    }
    rateLimiter.recordSuccess(ip);
    const viewer: ViewerConn = { role: "viewer", socket, code, ip };
    socketState.set(socket, viewer);
    pairings.set(code, { code, agent, viewer });
    log.info("paired", { code });
    sendTo(socket, {
      type: "agent-ready",
      code,
      mode: agent.mode,
      hostname: agent.hostname,
    });
    sendTo(agent.socket, { type: "viewer-connecting", code });
  }

  function forwardOffer(
    socket: WebSocket,
    code: string,
    sdp: { type: "offer" | "answer"; sdp: string },
  ): void {
    const pairing = pairings.get(code);
    if (!pairing || pairing.viewer.socket !== socket) {
      sendError(socket, "invalid_message");
      return;
    }
    sendTo(pairing.agent.socket, { type: "peer-offer", sdp });
  }

  function forwardAnswer(
    socket: WebSocket,
    code: string,
    sdp: { type: "offer" | "answer"; sdp: string },
  ): void {
    const pairing = pairings.get(code);
    if (!pairing || pairing.agent.socket !== socket) {
      sendError(socket, "invalid_message");
      return;
    }
    sendTo(pairing.viewer.socket, { type: "peer-answer", sdp });
  }

  function forwardIce(
    socket: WebSocket,
    code: string,
    candidate: { candidate: string },
    target: "agent" | "viewer",
  ): void {
    const pairing = pairings.get(code);
    if (!pairing) {
      sendError(socket, "invalid_message");
      return;
    }
    const sender = pairing.agent.socket === socket ? "agent" : "viewer";
    const recipient =
      target === "agent" ? pairing.agent.socket : pairing.viewer.socket;
    // Sender must not target itself.
    if (sender === target) {
      sendError(socket, "invalid_message");
      return;
    }
    sendTo(recipient, {
      type: "ice-candidate",
      candidate: candidate as never,
    });
  }

  function handleUnregister(socket: WebSocket, code: string): void {
    const state = socketState.get(socket);
    if (!state || state.role !== "agent" || state.code !== code) {
      sendError(socket, "invalid_message");
      return;
    }
    registry.unregister(code);
    pairings.delete(code);
  }

  function cleanupSocket(socket: WebSocket): void {
    const state = socketState.get(socket);
    if (!state) return;
    socketState.delete(socket);
    if (state.role === "agent") {
      registry.unregister(state.code);
      const p = pairings.get(state.code);
      if (p) {
        pairings.delete(state.code);
        if (p.viewer.socket.readyState === p.viewer.socket.OPEN) {
          p.viewer.socket.close();
        }
      }
      log.info("agent disconnected", { code: state.code });
    } else {
      const p = pairings.get(state.code);
      if (p && p.viewer.socket === socket) {
        pairings.delete(state.code);
        if (p.agent.socket.readyState === p.agent.socket.OPEN) {
          p.agent.socket.close();
        }
      }
      log.info("viewer disconnected", { code: state.code });
    }
  }

  wss.on("connection", (socket, req) => {
    const ip = extractIp(req);
    socket.on("message", (data) => handleMessage(socket, ip, data.toString()));
    socket.on("close", () => cleanupSocket(socket));
    socket.on("error", (err) => {
      log.warn("ws error", { ip, error: String(err) });
    });
  });

  return new Promise((resolve) => {
    httpServer.listen(cfg.port, () => {
      log.info("signaling listening", { port: cfg.port });
      resolve({
        http: httpServer,
        ws: wss,
        registry,
        close: async () => {
          clearInterval(sweep);
          await new Promise<void>((r, j) =>
            wss.close((err) => (err ? j(err) : r())),
          );
          await new Promise<void>((r, j) =>
            httpServer.close((err) => (err ? j(err) : r())),
          );
        },
      });
    });
  });
}

function extractIp(req: http.IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) {
    const first = fwd.split(",")[0];
    if (first) return first.trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}
