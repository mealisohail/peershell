// TerminalConnection — the byte pipe between an already-open WebRTC data
// channel and a Session.
//
// This wrapper does NOT own the pairing/handshake flow (main.ts still owns
// that). It takes a live RTCDataChannel + the Peer/SignalingClient that
// produced it, and:
//   - fans inbound binary frames into the Session's output buffer
//   - exposes sendInput / sendResize for the focused pane to write into
//   - on dispose, closes the peer + signaling client
//
// Keeping this small and transport-agnostic-of-the-rest means the Session
// model stays testable without faking RTCDataChannel.
import type { Peer } from "../webrtc.ts";
import type { SignalingClient } from "../signaling.ts";
import type { Session } from "./Session.ts";
import type { SessionStatus } from "./types.ts";

export type TerminalConnectionOptions = {
  channel: RTCDataChannel;
  peer: Peer;
  signaling: SignalingClient;
  session: Session;
};

const encoder = new TextEncoder();

export class TerminalConnection {
  private readonly channel: RTCDataChannel;
  private readonly peer: Peer;
  private readonly signaling: SignalingClient;
  private readonly session: Session;
  private disposed = false;

  // Track listeners so we can unwire cleanly on dispose.
  private readonly messageHandler: (ev: MessageEvent) => void;
  private readonly closeHandler: () => void;

  constructor(opts: TerminalConnectionOptions) {
    this.channel = opts.channel;
    this.peer = opts.peer;
    this.signaling = opts.signaling;
    this.session = opts.session;

    this.channel.binaryType = "arraybuffer";

    this.messageHandler = (ev: MessageEvent): void => {
      if (typeof ev.data === "string") {
        // No control frames inbound in v1; reserved for future use.
        return;
      }
      if (ev.data instanceof ArrayBuffer) {
        this.session.appendOutput(new Uint8Array(ev.data));
      }
    };

    this.closeHandler = (): void => {
      this.session.setStatus("disconnected");
    };

    this.channel.addEventListener("message", this.messageHandler);
    this.channel.addEventListener("close", this.closeHandler);
  }

  /** Reflect a peer-connection state into the session. Called by main.ts
   * when the RTCPeerConnection emits a state change. */
  updateStatus(status: SessionStatus): void {
    this.session.setStatus(status);
  }

  /** Read-only RTCPeerConnection passthrough for the diagnostics panel.
   * Callers must not invoke mutating methods. */
  getPeerConnection(): RTCPeerConnection {
    return this.peer.peerConnection;
  }

  /** Send a chunk of user keystrokes. Caller must already have checked
   * that the calling pane is the session's focus owner. */
  sendInput(data: Uint8Array): void {
    if (this.disposed) return;
    if (this.channel.readyState !== "open") return;
    // Cast through `unknown`: RTCDataChannel.send's stricter `ArrayBufferView<ArrayBuffer>`
    // overload rejects `Uint8Array<ArrayBufferLike>` purely as a type-only
    // concern. Runtime behavior is identical — the encoder produces an
    // ArrayBuffer-backed view.
    this.channel.send(data as unknown as ArrayBuffer);
  }

  /** Send a resize control frame (string/JSON). */
  sendResize(cols: number, rows: number): void {
    if (this.disposed) return;
    if (this.channel.readyState !== "open") return;
    this.channel.send(JSON.stringify({ type: "resize", cols, rows }));
  }

  /** Tear everything down: channel listeners, peer connection, signaling
   * websocket. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.channel.removeEventListener("message", this.messageHandler);
      this.channel.removeEventListener("close", this.closeHandler);
      this.channel.close();
    } catch {
      // Channel may already be in a terminal state.
    }
    try {
      this.peer.close();
    } catch {
      // ignore
    }
    try {
      this.signaling.close();
    } catch {
      // ignore
    }
  }

}

// Convenience for callers that have a plain string to send (most TerminalPane
// emits are strings from term.onData).
export function encodeAsBytes(s: string): Uint8Array {
  return encoder.encode(s);
}
