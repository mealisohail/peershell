// Session = one WebRTC connection to one Peershell agent.
//
// Multiple tabs and panes can attach to a single session (refcounted). The
// session owns:
//   - the recent-output ring buffer (for replaying to newly-attached panes)
//   - the focus owner (only one attachment writes keystrokes to the wire)
//   - status (which all attachments observe via onStatusChange)
//
// This file is *transport-agnostic*: it does not talk to WebRTC directly.
// The SessionManager wires the real connection (existing signaling/webrtc/
// terminal modules) to a Session instance via appendOutput + setStatus.
import { OutputBuffer } from "./OutputBuffer.ts";
import type { SessionMode, SessionStatus } from "./types.ts";

const DEFAULT_BUFFER_BYTES = 200 * 1024;

export type SessionOptions = {
  id: string;
  pairingCode: string;
  /** Defaults to 200 KB. Override for tests. */
  bufferCapacityBytes?: number;
};

type OutputListener = (chunk: Uint8Array) => void;
type StatusListener = (status: SessionStatus) => void;

export class Session {
  readonly id: string;
  readonly pairingCode: string;
  readonly outputBuffer: OutputBuffer;

  hostname: string | null = null;
  status: SessionStatus = "pairing";
  /** Permission mode advertised by the agent. Once set at pairing time it
   * does not change for the lifetime of the session. */
  mode: SessionMode = "full";
  /** Most-recent working directory reported by the host via OSC 7. */
  cwd: string | null = null;

  /**
   * Ordered list of attachment ids. Order matters: when the focused owner
   * detaches, focus transfers to whoever's next.
   */
  private attachments: string[] = [];
  private focusOwner: string | null = null;

  private outputListeners = new Set<OutputListener>();
  private statusListeners = new Set<StatusListener>();
  private cwdListeners = new Set<(cwd: string | null) => void>();

  constructor(opts: SessionOptions) {
    this.id = opts.id;
    this.pairingCode = opts.pairingCode;
    this.outputBuffer = new OutputBuffer(
      opts.bufferCapacityBytes ?? DEFAULT_BUFFER_BYTES,
    );
  }

  get refCount(): number {
    return this.attachments.length;
  }

  get focusedAttachmentId(): string | null {
    return this.focusOwner;
  }

  isOrphan(): boolean {
    return this.attachments.length === 0;
  }

  attach(attachmentId: string): void {
    if (this.attachments.includes(attachmentId)) return;
    this.attachments.push(attachmentId);
    if (this.focusOwner === null) {
      this.focusOwner = attachmentId;
    }
  }

  detach(attachmentId: string): void {
    const idx = this.attachments.indexOf(attachmentId);
    if (idx === -1) return;
    this.attachments.splice(idx, 1);
    if (this.focusOwner === attachmentId) {
      this.focusOwner = this.attachments[0] ?? null;
    }
  }

  setFocus(attachmentId: string): void {
    if (!this.attachments.includes(attachmentId)) {
      throw new Error(
        `Session: cannot focus unattached id ${attachmentId} on session ${this.id}`,
      );
    }
    this.focusOwner = attachmentId;
  }

  setStatus(status: SessionStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const l of this.statusListeners) l(status);
  }

  setHostname(hostname: string): void {
    this.hostname = hostname;
  }

  setMode(mode: SessionMode): void {
    this.mode = mode;
  }

  setCwd(cwd: string | null): void {
    if (this.cwd === cwd) return;
    this.cwd = cwd;
    for (const l of this.cwdListeners) l(cwd);
  }

  onCwdChange(listener: (cwd: string | null) => void): () => void {
    this.cwdListeners.add(listener);
    return () => this.cwdListeners.delete(listener);
  }

  appendOutput(chunk: Uint8Array): void {
    if (chunk.length === 0) return;
    this.outputBuffer.append(chunk);
    for (const l of this.outputListeners) l(chunk);
  }

  onOutput(listener: OutputListener): () => void {
    this.outputListeners.add(listener);
    return () => this.outputListeners.delete(listener);
  }

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /**
   * Drop all listeners. Caller of SessionManager calls this when disposing
   * a session — it does NOT close the underlying transport (that's the
   * SessionManager's job).
   */
  dispose(): void {
    this.outputListeners.clear();
    this.statusListeners.clear();
    this.cwdListeners.clear();
    this.attachments = [];
    this.focusOwner = null;
    this.outputBuffer.clear();
  }
}
