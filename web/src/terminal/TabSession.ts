// TabSession — per-tab lifecycle for the pairing → connecting → live → ended
// state machine. Extracted out of main.ts so multiple tabs can each run
// their own pair/connect flow independently.
//
// Two modes:
//   1. NEW SESSION: `startNew(code)` does the full WebRTC pairing dance
//      against the signaling server. On success, a Session is created via
//      the shared SessionManager and a TerminalConnection wraps the
//      open RTCDataChannel.
//   2. SAME SESSION: `attachSame(session)` skips pairing and binds this
//      tab to an existing Session that another tab already established.
//      The underlying WebRTC connection is shared via the SessionManager
//      refcount.
//
// Either way, the Session + connection are owned by the SessionManager,
// not by the TabSession itself. The TabSession holds the *attachment*
// (one paneId per tab) and tears it down on dispose.
import { SignalingClient, type ErrorReason, type ServerMessage } from "../signaling.ts";
import { Peer } from "../webrtc.ts";
import type { SessionManager } from "./SessionManager.ts";
import type { Session } from "./Session.ts";
import { TerminalConnection } from "./TerminalConnection.ts";
import type { SessionMode } from "./types.ts";

export type TabSessionPhase =
  | { kind: "idle" }
  | { kind: "pairing"; code: string }
  /**
   * Agent located and metadata received; the WebRTC handshake has NOT
   * started yet. The pairing screen displays the mode/hostname to the
   * user and waits for an explicit "Connect" click before commit().
   */
  | {
      kind: "preview";
      code: string;
      mode: SessionMode;
      hostname: string | null;
    }
  | { kind: "connecting"; code: string; session: Session; connection: TerminalConnection }
  | {
      kind: "live";
      code: string;
      session: Session;
      connection: TerminalConnection;
      channel: RTCDataChannel;
    }
  | { kind: "ended"; reason: TabEndedReason; message?: string }
  | { kind: "error"; message: string };

export type TabEndedReason = "user" | "remote" | "failed";

export type TabSessionOptions = {
  signalingUrl: string;
  stunUrl: string;
  sessionManager: SessionManager;
  /** Notified on every phase transition. */
  onPhase: (phase: TabSessionPhase) => void;
};

const ERROR_COPY: Record<ErrorReason, string> = {
  code_not_found:
    "That code doesn't match an active agent. Check the digits with the host and try again.",
  code_expired:
    "That code expired. Codes live for 10 minutes — ask the host to run the agent again for a fresh one.",
  rate_limited:
    "Too many attempts from this address. Wait a minute, then try again.",
  agent_busy:
    "That agent is already connected to someone else. One viewer per code; ask the host to start a new session.",
  duplicate_code:
    "The server rejected the code (already in use). Ask the host for a new one.",
  invalid_message: "Signaling server hit an unexpected error. Try again.",
  internal_error: "Signaling server hit an unexpected error. Try again.",
};

export class TabSession {
  private phase: TabSessionPhase = { kind: "idle" };
  private peer: Peer | null = null;
  private client: SignalingClient | null = null;
  private codeInFlight: string | null = null;
  /** Agent metadata captured at agent-ready, applied on commit. */
  private previewMeta: { mode: SessionMode; hostname: string | null } | null =
    null;
  private readonly opts: TabSessionOptions;

  constructor(opts: TabSessionOptions) {
    this.opts = opts;
  }

  current(): TabSessionPhase {
    return this.phase;
  }

  /** Begin a fresh pairing flow with `code`. */
  async startNew(code: string): Promise<void> {
    this.dispose(); // safe to call repeatedly
    this.codeInFlight = code;
    this.setPhase({ kind: "pairing", code });

    const client = new SignalingClient({ url: this.opts.signalingUrl });
    const peer = new Peer(
      { stunUrl: this.opts.stunUrl },
      {
        onLocalIceCandidate: (cand) => client.sendIceCandidate(code, cand),
        onChannelOpen: (channel) => this.onChannelOpen(code, channel),
        onConnectionStateChange: (state) => this.onPCStateChange(state),
      },
    );
    this.client = client;
    this.peer = peer;

    client.onStatus((s) => {
      if (s === "closed" && this.phase.kind === "pairing") {
        this.setPhase({
          kind: "error",
          message: "Lost the signaling connection before pairing finished.",
        });
      }
    });
    client.onMessage((msg) => void this.handleServerMessage(msg, code));

    try {
      await client.connect();
    } catch {
      this.setPhase({
        kind: "error",
        message:
          "Couldn't reach the signaling server. Check the URL and try again.",
      });
      return;
    }
    client.sendConnect(code);
  }

  /**
   * Attach this tab to an already-live Session that another tab opened.
   * Skips pairing entirely; the SessionManager refcount goes up.
   */
  attachSame(session: Session): void {
    this.dispose();
    // Look up the matching TerminalConnection — the manager-owned map lives
    // in TerminalApp; the caller passes both pieces in via the live phase.
    // (This wrapper just transitions phase; the actual attach() happens in
    // TerminalPane on mount.)
    this.codeInFlight = session.pairingCode;
    // Synthesize a "live" phase. We don't have the channel reference here;
    // the caller (TerminalApp) already holds it via connectionsBySession.
    // Phase machinery isn't responsible for the channel, so we omit it.
    // Construct a phase that signals "we're attached to this live session".
    this.setPhase({
      kind: "live",
      code: session.pairingCode,
      session,
      // The connection is shared and owned by the SessionManager + map in
      // TerminalApp; the TabSession doesn't need to call dispose on it.
      // Pass a no-op proxy so the type fits.
      connection: null as unknown as TerminalConnection,
      channel: null as unknown as RTCDataChannel,
    });
  }

  /**
   * Called by the UI when the user confirms the preview and clicks the
   * final Connect button. Kicks off the WebRTC offer/answer dance using
   * the SignalingClient + Peer already wired during startNew.
   */
  async commit(): Promise<void> {
    if (this.phase.kind !== "preview") return;
    if (!this.peer || !this.client) return;
    const code = this.phase.code;
    try {
      const offer = await this.peer.createOffer();
      this.client.sendPeerOffer(code, offer);
    } catch (err) {
      this.setPhase({
        kind: "error",
        message: `Couldn't start the WebRTC handshake: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }
  }

  /** Force the session into the ended state and notify listeners. */
  end(reason: TabEndedReason): void {
    this.setPhase({ kind: "ended", reason });
  }

  /**
   * Tear down WebRTC + signaling pieces this TabSession owns directly.
   * Does NOT dispose the Session in the manager — the caller (TerminalApp)
   * handles refcount via session.detach().
   */
  dispose(): void {
    if (this.peer) {
      try {
        this.peer.close();
      } catch {
        /* ignore */
      }
      this.peer = null;
    }
    if (this.client) {
      try {
        this.client.close();
      } catch {
        /* ignore */
      }
      this.client = null;
    }
  }

  // ── private ────────────────────────────────────────────────────────────

  private setPhase(phase: TabSessionPhase): void {
    this.phase = phase;
    this.opts.onPhase(phase);
  }

  private onChannelOpen(code: string, channel: RTCDataChannel): void {
    if (!this.peer || !this.client) return;
    const session = this.opts.sessionManager.create({ pairingCode: code });
    if (this.previewMeta) {
      session.setMode(this.previewMeta.mode);
      if (this.previewMeta.hostname) session.setHostname(this.previewMeta.hostname);
    }
    const connection = new TerminalConnection({
      channel,
      peer: this.peer,
      signaling: this.client,
      session,
    });
    connection.updateStatus("connected");
    // From this point the SessionManager owns peer + signaling teardown
    // through onBeforeDispose; clear our local refs so dispose() is a no-op.
    this.peer = null;
    this.client = null;
    this.setPhase({ kind: "live", code, session, connection, channel });
  }

  private onPCStateChange(state: RTCPeerConnectionState): void {
    const current = this.phase;
    if (current.kind === "live" && current.connection) {
      current.connection.updateStatus(mapPCState(state));
    }
    if (state === "failed" || state === "disconnected") {
      if (current.kind === "live") {
        this.setPhase({ kind: "ended", reason: "failed" });
      } else if (current.kind === "pairing" || current.kind === "connecting") {
        this.setPhase({
          kind: "error",
          message:
            "WebRTC connection failed before the channel opened. Try again.",
        });
      }
    }
  }

  private async handleServerMessage(
    msg: ServerMessage,
    code: string,
  ): Promise<void> {
    if (!this.peer || !this.client) return;
    if (this.codeInFlight !== code) return; // stale message
    switch (msg.type) {
      case "agent-ready": {
        // Don't fire the WebRTC offer yet — hold at preview until the user
        // confirms via TabSession.commit(). This is where the pairing
        // screen shows the mode pill + final Connect button.
        const mode: SessionMode = msg.mode === "view-only" ? "view-only" : "full";
        const hostname = msg.hostname ?? null;
        this.previewMeta = { mode, hostname };
        this.setPhase({ kind: "preview", code, mode, hostname });
        return;
      }
      case "peer-answer":
        await this.peer.setRemoteAnswer(msg.sdp);
        return;
      case "ice-candidate":
        try {
          await this.peer.addRemoteIceCandidate(msg.candidate);
        } catch (err) {
          console.warn("[webrtc] addIceCandidate failed", err);
        }
        return;
      case "error":
        if (this.phase.kind === "live") {
          this.setPhase({ kind: "ended", reason: "remote" });
        } else {
          this.setPhase({
            kind: "error",
            message: ERROR_COPY[msg.reason],
          });
        }
        return;
    }
  }
}

function mapPCState(
  state: RTCPeerConnectionState,
): "connected" | "connecting" | "disconnected" | "error" {
  switch (state) {
    case "new":
    case "connecting":
      return "connecting";
    case "connected":
      return "connected";
    case "disconnected":
    case "closed":
      return "disconnected";
    case "failed":
      return "error";
  }
}
