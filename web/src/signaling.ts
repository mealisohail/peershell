// Browser-side signaling client. Mirrors the wire protocol defined in
// signaling/src/protocol.ts (single source of truth lives there).
//
// WebSocket is injected via `wsFactory` so the same module is testable in Node
// with a fake socket.

export type SdpInit = { type: "offer" | "answer"; sdp: string };

export type IceCandidateInit = {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
};

export type ErrorReason =
  | "code_not_found"
  | "code_expired"
  | "rate_limited"
  | "agent_busy"
  | "duplicate_code"
  | "invalid_message"
  | "internal_error";

/** Permission mode the agent advertises (and the viewer learns at
 * agent-ready time). Older servers may omit it; treat absence as "full". */
export type SessionMode = "full" | "view-only";

export type ServerMessage =
  | {
      type: "agent-ready";
      code: string;
      mode?: SessionMode;
      hostname?: string;
    }
  | { type: "peer-answer"; sdp: SdpInit }
  | { type: "ice-candidate"; candidate: IceCandidateInit }
  | { type: "error"; reason: ErrorReason };

export type Status = "connecting" | "open" | "closed";

export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "close", listener: () => void): void;
  addEventListener(
    type: "message",
    listener: (event: { data: unknown }) => void,
  ): void;
  addEventListener(type: "error", listener: () => void): void;
}

export type WSFactory = (url: string) => WebSocketLike;

export type SignalingOptions = {
  url: string;
  wsFactory?: WSFactory;
};

const KNOWN_TYPES = new Set<ServerMessage["type"]>([
  "agent-ready",
  "peer-answer",
  "ice-candidate",
  "error",
]);

export class SignalingClient {
  private readonly url: string;
  private readonly wsFactory: WSFactory;
  private ws: WebSocketLike | null = null;
  private messageListeners: Array<(m: ServerMessage) => void> = [];
  private statusListeners: Array<(s: Status) => void> = [];

  constructor(opts: SignalingOptions) {
    this.url = opts.url;
    this.wsFactory =
      opts.wsFactory ??
      ((url: string) => new WebSocket(url) as WebSocketLike);
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = this.wsFactory(this.url);
      this.ws = ws;
      this.emitStatus("connecting");

      let settled = false;
      ws.addEventListener("open", () => {
        if (settled) return;
        settled = true;
        this.emitStatus("open");
        resolve();
      });
      ws.addEventListener("error", () => {
        if (!settled) {
          settled = true;
          reject(new Error("signaling: websocket error"));
        }
      });
      ws.addEventListener("close", () => {
        this.emitStatus("closed");
      });
      ws.addEventListener("message", (ev) => {
        this.handleIncoming(ev.data);
      });
    });
  }

  onMessage(listener: (msg: ServerMessage) => void): void {
    this.messageListeners.push(listener);
  }

  onStatus(listener: (status: Status) => void): void {
    this.statusListeners.push(listener);
  }

  sendConnect(code: string): void {
    this.send({ type: "connect", role: "viewer", code });
  }

  sendPeerOffer(code: string, sdp: SdpInit): void {
    this.send({ type: "peer-offer", code, sdp });
  }

  sendIceCandidate(code: string, candidate: IceCandidateInit): void {
    this.send({
      type: "ice-candidate",
      code,
      candidate,
      target: "agent",
    });
  }

  close(): void {
    this.ws?.close();
  }

  private send(payload: unknown): void {
    if (!this.ws) throw new Error("signaling: not connected");
    this.ws.send(JSON.stringify(payload));
  }

  private emitStatus(status: Status): void {
    for (const l of this.statusListeners) l(status);
  }

  private handleIncoming(data: unknown): void {
    if (typeof data !== "string") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return;
    }
    const type = (parsed as { type?: unknown }).type;
    if (typeof type !== "string" || !KNOWN_TYPES.has(type as ServerMessage["type"])) {
      return;
    }
    for (const l of this.messageListeners) l(parsed as ServerMessage);
  }
}
