// DiagnosticsPanel — glance-able popover anchored to the connection-status
// pill's info icon. Polls RTCPeerConnection.getStats() every 2s while open;
// stops polling on close but keeps the last snapshot for instant reopen.
//
// Data sources (per WebRTC stats spec):
//   - transport report          → dtlsState, selectedCandidatePairId
//   - selected candidate-pair   → RTT, bytes sent/received, available bw
//   - local-candidate report    → candidateType (host/srflx/prflx/relay)
//   - data-channel report       → messages + bytes (data channels don't
//                                 carry jitter/packetsLost — those are
//                                 RTP-only and intentionally omitted)
import "../styles/diagnostics.css";
import type { Session } from "./Session.ts";

const INFO_ICON = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
const COPY_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const CHECK_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>`;
const CLOSE_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

const POLL_INTERVAL_MS = 2000;

export type DiagnosticsContext = {
  pc: RTCPeerConnection;
  session: Session;
  startedAt: number;
};

export type DiagnosticsPanelOptions = {
  anchorEl: HTMLElement;
  getContext: () => DiagnosticsContext | null;
};

export type DiagnosticsPanelController = {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  dispose(): void;
};

type CandidateType = "host" | "srflx" | "prflx" | "relay" | "unknown";

type Snapshot = {
  /** ms since session started */
  uptimeMs: number;
  candidateType: CandidateType;
  rttMs: number | null;
  availableOutgoingBytesPerSec: number | null;
  bytesSent: number;
  bytesReceived: number;
  messagesSent: number;
  messagesReceived: number;
  packetsLost: number | null;
  packetsTotal: number | null;
  dtlsState: string;
  iceConnectionState: RTCIceConnectionState;
  iceGatheringState: RTCIceGatheringState;
  localSdpType: string;
  remoteSdpType: string;
};

export function mountDiagnosticsPanel(
  root: HTMLElement,
  opts: DiagnosticsPanelOptions,
): DiagnosticsPanelController {
  const wrap = document.createElement("div");
  wrap.className = "diag";
  wrap.hidden = true;
  wrap.setAttribute("role", "dialog");
  wrap.setAttribute("aria-label", "Connection details");
  wrap.innerHTML = `
    <div class="diag__shell">
      <header class="diag__head">
        <h3 class="diag__title">Connection</h3>
        <button class="diag__close" type="button" data-close aria-label="Close diagnostics">${CLOSE_ICON}</button>
      </header>
      <div class="diag__body" data-body>
        <p class="diag__placeholder">Collecting stats…</p>
      </div>
      <footer class="diag__foot">
        <button class="diag__copy" type="button" data-copy>
          <span class="diag__copy-icon" data-copy-icon>${COPY_ICON}</span>
          <span data-copy-label>Copy diagnostics</span>
        </button>
      </footer>
    </div>
  `;
  root.appendChild(wrap);

  const shell = wrap.querySelector<HTMLElement>(".diag__shell")!;
  const body = wrap.querySelector<HTMLElement>("[data-body]")!;
  const closeBtn = wrap.querySelector<HTMLButtonElement>("[data-close]")!;
  const copyBtn = wrap.querySelector<HTMLButtonElement>("[data-copy]")!;
  const copyIcon = wrap.querySelector<HTMLElement>("[data-copy-icon]")!;
  const copyLabel = wrap.querySelector<HTMLElement>("[data-copy-label]")!;

  let isOpen = false;
  let pollHandle: number | null = null;
  let lastSnapshot: Snapshot | null = null;
  let lastContext: DiagnosticsContext | null = null;

  function positionAnchored(): void {
    const r = opts.anchorEl.getBoundingClientRect();
    const margin = 8;
    const shellW = 360;
    let left = r.right - shellW; // right-align under the pill
    left = Math.max(margin, Math.min(window.innerWidth - shellW - margin, left));
    const top = Math.max(margin, r.bottom + 8);
    shell.style.top = `${top}px`;
    shell.style.left = `${left}px`;
  }

  async function pollOnce(): Promise<void> {
    const ctx = opts.getContext();
    lastContext = ctx;
    if (!ctx) {
      render(null, null);
      return;
    }
    try {
      const snap = await captureSnapshot(ctx);
      lastSnapshot = snap;
      render(snap, ctx);
    } catch (err) {
      const note = document.createElement("p");
      note.className = "diag__placeholder";
      note.textContent = `Failed to read stats: ${err instanceof Error ? err.message : String(err)}`;
      body.innerHTML = "";
      body.appendChild(note);
    }
  }

  function startPolling(): void {
    if (pollHandle !== null) return;
    void pollOnce();
    pollHandle = window.setInterval(() => void pollOnce(), POLL_INTERVAL_MS);
  }

  function stopPolling(): void {
    if (pollHandle !== null) {
      window.clearInterval(pollHandle);
      pollHandle = null;
    }
  }

  function open(): void {
    if (isOpen) return;
    isOpen = true;
    wrap.hidden = false;
    positionAnchored();
    requestAnimationFrame(() => wrap.classList.add("is-open"));
    if (lastSnapshot && lastContext) {
      render(lastSnapshot, lastContext);
    }
    startPolling();
  }

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    wrap.classList.remove("is-open");
    setTimeout(() => {
      wrap.hidden = true;
    }, 160);
    stopPolling();
  }

  function toggle(): void {
    if (isOpen) close();
    else open();
  }

  // Outside-click / Esc dismissal.
  const onDocClick = (ev: MouseEvent): void => {
    if (!isOpen) return;
    const target = ev.target as Node;
    if (wrap.contains(target)) return;
    if (opts.anchorEl.contains(target)) return; // the anchor itself toggles
    close();
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (isOpen && ev.key === "Escape") {
      ev.preventDefault();
      close();
    }
  };
  const onResize = (): void => {
    if (isOpen) positionAnchored();
  };
  document.addEventListener("mousedown", onDocClick);
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", onResize);

  closeBtn.addEventListener("click", close);
  copyBtn.addEventListener("click", async () => {
    if (!lastSnapshot || !lastContext) return;
    try {
      await navigator.clipboard.writeText(formatPlaintext(lastSnapshot, lastContext));
      copyIcon.innerHTML = CHECK_ICON;
      copyLabel.textContent = "Copied";
      setTimeout(() => {
        copyIcon.innerHTML = COPY_ICON;
        copyLabel.textContent = "Copy diagnostics";
      }, 1400);
    } catch {
      // Silent — clipboard may be blocked.
    }
  });

  function render(snap: Snapshot | null, ctx: DiagnosticsContext | null): void {
    if (!snap || !ctx) {
      body.innerHTML = `<p class="diag__placeholder">No active session.</p>`;
      return;
    }
    body.innerHTML = renderHtml(snap, ctx);
  }

  return {
    open,
    close,
    toggle,
    isOpen: () => isOpen,
    dispose: () => {
      stopPolling();
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      wrap.remove();
    },
  };
}

// Re-export the info icon so AppBar can use the same artwork.
export function infoIconHtml(): string {
  return INFO_ICON;
}

// ── stats capture ───────────────────────────────────────────────────────

async function captureSnapshot(ctx: DiagnosticsContext): Promise<Snapshot> {
  const report = await ctx.pc.getStats();

  let transport: RTCStats | null = null;
  let dataChannel: RTCStats | null = null;
  let selectedPair: RTCStats | null = null;
  const stats = new Map<string, RTCStats>();
  for (const [id, stat] of report) {
    stats.set(id, stat);
  }

  for (const stat of stats.values()) {
    if (stat.type === "transport") {
      transport = stat;
      const sel = (stat as unknown as { selectedCandidatePairId?: string })
        .selectedCandidatePairId;
      if (sel) {
        selectedPair = stats.get(sel) ?? null;
      }
    }
    if (stat.type === "data-channel" && !dataChannel) {
      dataChannel = stat;
    }
  }

  // Fallback: scan candidate-pair reports for one that's selected/nominated.
  if (!selectedPair) {
    for (const stat of stats.values()) {
      if (stat.type !== "candidate-pair") continue;
      const cp = stat as unknown as {
        state?: string;
        nominated?: boolean;
        selected?: boolean;
      };
      if (cp.selected || (cp.state === "succeeded" && cp.nominated)) {
        selectedPair = stat;
        break;
      }
    }
  }

  let localCandidate: RTCStats | null = null;
  const pair = selectedPair as unknown as { localCandidateId?: string } | null;
  if (pair?.localCandidateId) {
    localCandidate = stats.get(pair.localCandidateId) ?? null;
  }

  const pairAny = selectedPair as unknown as {
    currentRoundTripTime?: number;
    bytesSent?: number;
    bytesReceived?: number;
    availableOutgoingBitrate?: number;
    packetsLost?: number;
    packetsSent?: number;
    packetsReceived?: number;
  };
  const dcAny = dataChannel as unknown as {
    bytesSent?: number;
    bytesReceived?: number;
    messagesSent?: number;
    messagesReceived?: number;
  };
  const transportAny = transport as unknown as { dtlsState?: string };
  const localCandAny = localCandidate as unknown as {
    candidateType?: CandidateType;
  };

  const rttSeconds = pairAny?.currentRoundTripTime;
  const availableBitrate = pairAny?.availableOutgoingBitrate;
  const packetsSent = pairAny?.packetsSent ?? 0;
  const packetsReceived = pairAny?.packetsReceived ?? 0;
  const packetsLost = pairAny?.packetsLost ?? null;
  const packetsTotal =
    packetsSent + packetsReceived > 0 ? packetsSent + packetsReceived : null;

  return {
    uptimeMs: Date.now() - ctx.startedAt,
    candidateType: localCandAny?.candidateType ?? "unknown",
    rttMs:
      typeof rttSeconds === "number" ? Math.round(rttSeconds * 1000) : null,
    availableOutgoingBytesPerSec:
      typeof availableBitrate === "number"
        ? Math.round(availableBitrate / 8)
        : null,
    bytesSent: dcAny?.bytesSent ?? pairAny?.bytesSent ?? 0,
    bytesReceived: dcAny?.bytesReceived ?? pairAny?.bytesReceived ?? 0,
    messagesSent: dcAny?.messagesSent ?? 0,
    messagesReceived: dcAny?.messagesReceived ?? 0,
    packetsLost,
    packetsTotal,
    dtlsState: transportAny?.dtlsState ?? "—",
    iceConnectionState: ctx.pc.iceConnectionState,
    iceGatheringState: ctx.pc.iceGatheringState,
    localSdpType: ctx.pc.currentLocalDescription?.type ?? "—",
    remoteSdpType: ctx.pc.currentRemoteDescription?.type ?? "—",
  };
}

// ── rendering ───────────────────────────────────────────────────────────

function renderHtml(snap: Snapshot, ctx: DiagnosticsContext): string {
  const isRelay = snap.candidateType === "relay";
  const isP2P =
    snap.candidateType === "host" ||
    snap.candidateType === "srflx" ||
    snap.candidateType === "prflx";

  const pathBanner = isRelay
    ? `<div class="diag__banner diag__banner--warn">
         <span class="diag__banner-icon">⚠</span>
         Connection is going through a TURN relay, not peer-to-peer.
       </div>`
    : isP2P
      ? `<div class="diag__banner diag__banner--ok">
           <span class="diag__banner-icon">✓</span>
           Peer-to-peer connection.
         </div>`
      : "";

  const pkt =
    snap.packetsTotal && snap.packetsLost !== null
      ? `${snap.packetsLost} (${((snap.packetsLost / snap.packetsTotal) * 100).toFixed(2)}%)`
      : snap.packetsLost !== null
        ? String(snap.packetsLost)
        : "—";

  return `
    ${pathBanner}

    <section class="diag__section">
      <h4 class="diag__sec-head">Connection</h4>
      <dl class="diag__rows">
        ${row("Status", capitalize(ctx.session.status))}
        ${row("Mode", ctx.session.mode === "view-only" ? "View only" : "Full access")}
        ${row("Hostname", esc(ctx.session.hostname ?? "—"))}
        ${row("Pairing code", formatCode(ctx.session.pairingCode))}
        ${row("Connected for", formatDuration(snap.uptimeMs))}
        ${row("ICE candidate type", capitalize(snap.candidateType))}
      </dl>
    </section>

    <section class="diag__section">
      <h4 class="diag__sec-head">Performance</h4>
      <dl class="diag__rows">
        ${row("Round-trip latency", snap.rttMs !== null ? `${snap.rttMs} ms` : "—")}
        ${row("Packets lost", pkt)}
        ${row(
          "Available bandwidth (out)",
          snap.availableOutgoingBytesPerSec !== null
            ? `${formatBytes(snap.availableOutgoingBytesPerSec)}/s`
            : "—",
        )}
      </dl>
    </section>

    <section class="diag__section">
      <h4 class="diag__sec-head">Throughput</h4>
      <dl class="diag__rows">
        ${row("Bytes sent", formatBytes(snap.bytesSent))}
        ${row("Bytes received", formatBytes(snap.bytesReceived))}
        ${row("Messages sent", String(snap.messagesSent))}
        ${row("Messages received", String(snap.messagesReceived))}
      </dl>
    </section>

    <section class="diag__section">
      <h4 class="diag__sec-head">Negotiation</h4>
      <dl class="diag__rows">
        ${row("Local SDP type", snap.localSdpType)}
        ${row("Remote SDP type", snap.remoteSdpType)}
        ${row("DTLS state", snap.dtlsState)}
        ${row("ICE connection state", snap.iceConnectionState)}
        ${row("ICE gathering state", snap.iceGatheringState)}
      </dl>
    </section>
  `;
}

function row(label: string, value: string): string {
  return `
    <div class="diag__row">
      <dt>${esc(label)}</dt>
      <dd>${value}</dd>
    </div>
  `;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}

function formatCode(code: string): string {
  if (code.length !== 6) return code;
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function formatPlaintext(snap: Snapshot, ctx: DiagnosticsContext): string {
  const lines = [
    "Peershell diagnostics",
    "",
    "Connection",
    `  Status: ${capitalize(ctx.session.status)}`,
    `  Mode: ${ctx.session.mode === "view-only" ? "View only" : "Full access"}`,
    `  Hostname: ${ctx.session.hostname ?? "—"}`,
    `  Pairing code: ${formatCode(ctx.session.pairingCode)}`,
    `  Connected for: ${formatDuration(snap.uptimeMs)}`,
    `  ICE candidate type: ${snap.candidateType}`,
    "",
    "Performance",
    `  Round-trip latency: ${snap.rttMs !== null ? `${snap.rttMs} ms` : "—"}`,
    `  Packets lost: ${snap.packetsLost ?? "—"} (total: ${snap.packetsTotal ?? "—"})`,
    `  Available bandwidth (out): ${snap.availableOutgoingBytesPerSec !== null ? `${formatBytes(snap.availableOutgoingBytesPerSec)}/s` : "—"}`,
    "",
    "Throughput",
    `  Bytes sent: ${formatBytes(snap.bytesSent)}`,
    `  Bytes received: ${formatBytes(snap.bytesReceived)}`,
    `  Messages sent: ${snap.messagesSent}`,
    `  Messages received: ${snap.messagesReceived}`,
    "",
    "Negotiation",
    `  Local SDP type: ${snap.localSdpType}`,
    `  Remote SDP type: ${snap.remoteSdpType}`,
    `  DTLS state: ${snap.dtlsState}`,
    `  ICE connection state: ${snap.iceConnectionState}`,
    `  ICE gathering state: ${snap.iceGatheringState}`,
    "",
    `Captured at: ${new Date().toISOString()}`,
  ];
  return lines.join("\n");
}
