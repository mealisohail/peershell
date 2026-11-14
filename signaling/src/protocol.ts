// Wire protocol between signaling server and its two client roles (agent, viewer).
// This file is the single source of truth — the Go agent and the browser client
// must match these shapes.

export type SdpInit = { type: "offer" | "answer"; sdp: string };

export type IceCandidateInit = {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
};

// ── Client → Server ──────────────────────────────────────────────────────────

/**
 * Session permission mode advertised by the agent and forwarded to viewers.
 * `full` = viewer can type; `view-only` = viewer streams output only.
 * Optional in the wire so older agents that don't send it are treated as
 * full-access (back-compat).
 */
export type SessionMode = "full" | "view-only";

export type RegisterMsg = {
  type: "register";
  role: "agent";
  code: string;
  hostname: string;
  mode?: SessionMode;
};

export type ConnectMsg = {
  type: "connect";
  role: "viewer";
  code: string;
};

export type PeerOfferMsg = {
  type: "peer-offer";
  code: string;
  sdp: SdpInit;
};

export type PeerAnswerMsg = {
  type: "peer-answer";
  code: string;
  sdp: SdpInit;
};

export type IceCandidateMsg = {
  type: "ice-candidate";
  code: string;
  candidate: IceCandidateInit;
  target: "agent" | "viewer";
};

export type UnregisterMsg = {
  type: "unregister";
  code: string;
};

export type ClientMessage =
  | RegisterMsg
  | ConnectMsg
  | PeerOfferMsg
  | PeerAnswerMsg
  | IceCandidateMsg
  | UnregisterMsg;

// ── Server → Client ──────────────────────────────────────────────────────────

export type ErrorReason =
  | "code_not_found"
  | "code_expired"
  | "rate_limited"
  | "agent_busy"
  | "duplicate_code"
  | "invalid_message"
  | "internal_error";

export type ServerToAgent =
  | { type: "registered"; code: string }
  | { type: "viewer-connecting"; code: string }
  | { type: "peer-offer"; sdp: SdpInit }
  | { type: "ice-candidate"; candidate: IceCandidateInit }
  | { type: "error"; reason: ErrorReason };

export type ServerToViewer =
  | {
      type: "agent-ready";
      code: string;
      mode?: SessionMode;
      hostname?: string;
    }
  | { type: "peer-answer"; sdp: SdpInit }
  | { type: "ice-candidate"; candidate: IceCandidateInit }
  | { type: "error"; reason: ErrorReason };

// ── Parser ───────────────────────────────────────────────────────────────────

export type ParseResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; reason: string };

const CODE_RE = /^[0-9]{6}$/;

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isSdp(x: unknown): x is SdpInit {
  if (!isObject(x)) return false;
  if (x["type"] !== "offer" && x["type"] !== "answer") return false;
  if (typeof x["sdp"] !== "string") return false;
  return true;
}

function isCandidate(x: unknown): x is IceCandidateInit {
  if (!isObject(x)) return false;
  if (typeof x["candidate"] !== "string") return false;
  return true;
}

export function parseClientMessage(raw: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  if (!isObject(parsed)) return { ok: false, reason: "not_an_object" };

  const type = parsed["type"];
  if (typeof type !== "string") return { ok: false, reason: "missing_type" };

  switch (type) {
    case "register": {
      if (parsed["role"] !== "agent") return { ok: false, reason: "bad_role" };
      const code = parsed["code"];
      if (typeof code !== "string" || !CODE_RE.test(code))
        return { ok: false, reason: "bad_code" };
      const hostname = parsed["hostname"];
      if (typeof hostname !== "string")
        return { ok: false, reason: "bad_hostname" };
      const mode = parsed["mode"];
      if (mode !== undefined && mode !== "full" && mode !== "view-only") {
        return { ok: false, reason: "bad_mode" };
      }
      const msg: RegisterMsg = { type, role: "agent", code, hostname };
      if (mode) msg.mode = mode;
      return { ok: true, message: msg };
    }
    case "connect": {
      if (parsed["role"] !== "viewer") return { ok: false, reason: "bad_role" };
      const code = parsed["code"];
      if (typeof code !== "string" || !CODE_RE.test(code))
        return { ok: false, reason: "bad_code" };
      return { ok: true, message: { type, role: "viewer", code } };
    }
    case "peer-offer":
    case "peer-answer": {
      const code = parsed["code"];
      if (typeof code !== "string" || !CODE_RE.test(code))
        return { ok: false, reason: "bad_code" };
      const sdp = parsed["sdp"];
      if (!isSdp(sdp)) return { ok: false, reason: "bad_sdp" };
      return { ok: true, message: { type, code, sdp } };
    }
    case "ice-candidate": {
      const code = parsed["code"];
      if (typeof code !== "string" || !CODE_RE.test(code))
        return { ok: false, reason: "bad_code" };
      const candidate = parsed["candidate"];
      if (!isCandidate(candidate))
        return { ok: false, reason: "bad_candidate" };
      const target = parsed["target"];
      if (target !== "agent" && target !== "viewer")
        return { ok: false, reason: "bad_target" };
      return { ok: true, message: { type, code, candidate, target } };
    }
    case "unregister": {
      const code = parsed["code"];
      if (typeof code !== "string" || !CODE_RE.test(code))
        return { ok: false, reason: "bad_code" };
      return { ok: true, message: { type, code } };
    }
    default:
      return { ok: false, reason: "unknown_type" };
  }
}
