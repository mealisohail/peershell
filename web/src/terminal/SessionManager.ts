// SessionManager — lifecycle owner for Session instances.
//
// Responsibilities:
//   1. Allocate sessions and hold them in a Map by id.
//   2. Wrap Session.attach / Session.detach to add grace-period disposal:
//      when a session hits refCount=0, schedule a dispose after `graceMs`.
//      If something attaches before the timer fires, cancel.
//   3. Expose an onBeforeDispose hook so the WebRTC layer can close its
//      connection right before the Session record disappears.
//
// This module does NOT own WebRTC. It only models the Session graph; the
// consumer (TerminalApp) wires real transport into Session.appendOutput /
// Session.setStatus, and listens to onBeforeDispose to tear down the
// underlying connection.
import { Session } from "./Session.ts";

type Scheduler = {
  schedule: (ms: number, fn: () => void) => number;
  cancel: (handle: number) => void;
};

export type SessionManagerOptions = {
  graceMs?: number;
  schedule?: Scheduler["schedule"];
  cancel?: Scheduler["cancel"];
  /** Override id generator for tests. */
  idFactory?: () => string;
};

type BeforeDisposeListener = (session: Session) => void;

const DEFAULT_GRACE_MS = 5000;

let counter = 0;
const defaultId = (): string => {
  counter += 1;
  return `sess-${Date.now().toString(36)}-${counter.toString(36)}`;
};

export class SessionManager {
  private readonly sessions = new Map<string, Session>();
  private readonly pendingDispose = new Map<string, number>();
  private readonly listeners = new Set<BeforeDisposeListener>();
  private readonly graceMs: number;
  private readonly schedule: Scheduler["schedule"];
  private readonly cancel: Scheduler["cancel"];
  private readonly newId: () => string;

  constructor(opts: SessionManagerOptions = {}) {
    this.graceMs = opts.graceMs ?? DEFAULT_GRACE_MS;
    this.schedule =
      opts.schedule ??
      ((ms, fn) => window.setTimeout(fn, ms) as unknown as number);
    this.cancel =
      opts.cancel ?? ((handle) => window.clearTimeout(handle as unknown as number));
    this.newId = opts.idFactory ?? defaultId;
  }

  create(opts: { pairingCode: string; id?: string }): Session {
    const id = opts.id ?? this.newId();
    const session = new Session({ id, pairingCode: opts.pairingCode });
    this.sessions.set(id, session);
    return session;
  }

  get(id: string): Session | null {
    return this.sessions.get(id) ?? null;
  }

  list(): Session[] {
    return Array.from(this.sessions.values());
  }

  attach(sessionId: string, attachmentId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.attach(attachmentId);
    this.cancelPendingDispose(sessionId);
  }

  detach(sessionId: string, attachmentId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.detach(attachmentId);
    if (s.refCount === 0) {
      this.schedulePendingDispose(sessionId);
    }
  }

  disposeNow(sessionId: string): void {
    this.cancelPendingDispose(sessionId);
    this.dispose(sessionId);
  }

  onBeforeDispose(listener: BeforeDisposeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private schedulePendingDispose(sessionId: string): void {
    // Cancel any previous timer to avoid leaking double-scheduled disposes.
    this.cancelPendingDispose(sessionId);
    const handle = this.schedule(this.graceMs, () => {
      this.pendingDispose.delete(sessionId);
      this.dispose(sessionId);
    });
    this.pendingDispose.set(sessionId, handle);
  }

  private cancelPendingDispose(sessionId: string): void {
    const handle = this.pendingDispose.get(sessionId);
    if (handle !== undefined) {
      this.cancel(handle);
      this.pendingDispose.delete(sessionId);
    }
  }

  private dispose(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    // Fire the before-dispose hook with the session still registered, so
    // listeners can still inspect the manager state inside the hook.
    for (const l of this.listeners) l(s);
    this.sessions.delete(sessionId);
    s.dispose();
  }
}
