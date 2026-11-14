// Terminal session screen. Full-bleed xterm.js framed by:
//   - a top bar with wordmark, status pill, session timer, disconnect button
//   - a subtle bottom bar with the P2P · DTLS badge (hidden on mobile)
//   - a disconnect confirmation modal (opens on the Disconnect button)
//
// Phase B: switched from a raw RTCDataChannel to the new Session + Connection
// model. Single-tab/single-pane UI unchanged from the user's perspective;
// the difference is purely architectural — output flows session → pane,
// not channel → pane.
import "../styles/session.css";
import { mountPane, type TerminalPaneController } from "../terminal/TerminalPane.ts";
import type { Session } from "../terminal/Session.ts";
import type { TerminalConnection } from "../terminal/TerminalConnection.ts";

export type SessionOptions = {
  session: Session;
  connection: TerminalConnection;
  /** Stable id for this attachment (used by Session for focus tracking). */
  attachmentId: string;
  /** Display code (formatted in main.ts). */
  code: string;
  onDisconnect: () => void;
};

export type SessionController = {
  dispose(): void;
};

export function mountSession(
  root: HTMLElement,
  opts: SessionOptions,
): SessionController {
  root.innerHTML = `
    <div class="session">
      <header class="session__bar">
        <a class="session__brand" href="/">peershell</a>

        <div class="session__status">
          <span class="session__dot" aria-hidden="true"></span>
          <span class="session__status-text">Connected</span>
          <span class="session__divider" aria-hidden="true">·</span>
          <span class="session__code">${formatCode(opts.code)}</span>
        </div>

        <div class="session__actions">
          <span
            class="session__timer"
            data-timer
            aria-label="Session duration"
            title="Session just started"
          >00:00</span>
          <button class="session__disconnect" type="button" data-disconnect>
            Disconnect
          </button>
        </div>
      </header>

      <div class="session__term-wrap">
        <div class="session__term" data-term-host></div>
      </div>

      <footer class="session__footnote">
        <span class="session__badge">
          <span class="session__badge-dot"></span>
          P2P · DTLS
        </span>
      </footer>

      <div
        class="session__modal"
        data-modal
        hidden
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-modal-title"
        aria-describedby="session-modal-body"
      >
        <div class="session__modal-backdrop" data-modal-cancel></div>
        <div class="session__modal-card">
          <h3 class="session__modal-title" id="session-modal-title">
            End this session?
          </h3>
          <p class="session__modal-body" id="session-modal-body">
            Closes the terminal and tears down the peer connection. The host's
            shell process will exit. You'll need a new code to reconnect.
          </p>
          <div class="session__modal-actions">
            <button
              class="session__modal-btn session__modal-btn--ghost"
              type="button"
              data-modal-cancel
            >Stay connected</button>
            <button
              class="session__modal-btn session__modal-btn--danger"
              type="button"
              data-modal-confirm
            >Disconnect</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const sessionEl = root.querySelector<HTMLElement>(".session")!;
  const termHost = root.querySelector<HTMLElement>("[data-term-host]")!;
  const disconnectBtn = root.querySelector<HTMLButtonElement>(
    "[data-disconnect]",
  )!;
  const timerEl = root.querySelector<HTMLElement>("[data-timer]")!;
  const modal = root.querySelector<HTMLElement>("[data-modal]")!;
  const modalCancelEls = root.querySelectorAll<HTMLElement>("[data-modal-cancel]");
  const modalConfirm = root.querySelector<HTMLButtonElement>(
    "[data-modal-confirm]",
  )!;

  const pane: TerminalPaneController = mountPane(termHost, {
    session: opts.session,
    connection: opts.connection,
    attachmentId: opts.attachmentId,
  });

  const startedAt = Date.now();
  const timerHandle = window.setInterval(() => {
    timerEl.textContent = formatElapsed(Date.now() - startedAt);
    timerEl.title = describeDuration(Date.now() - startedAt);
  }, 1000);

  function openModal(): void {
    modal.hidden = false;
    requestAnimationFrame(() => {
      modal.classList.add("is-open");
      const cancel = modalCancelEls[0] as HTMLElement | undefined;
      cancel?.focus();
    });
  }

  function closeModal(): void {
    modal.classList.remove("is-open");
    setTimeout(() => {
      modal.hidden = true;
      disconnectBtn.focus();
    }, 180);
  }

  disconnectBtn.addEventListener("click", openModal);
  modalCancelEls.forEach((el) =>
    el.addEventListener("click", (ev) => {
      if (ev.target === el) closeModal();
    }),
  );
  modalConfirm.addEventListener("click", () => {
    closeModal();
    opts.onDisconnect();
  });
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape" && !modal.hidden) {
      ev.preventDefault();
      closeModal();
    }
  };
  document.addEventListener("keydown", onKey);

  requestAnimationFrame(() => {
    sessionEl.classList.add("is-mounted");
  });

  return {
    dispose: () => {
      window.clearInterval(timerHandle);
      document.removeEventListener("keydown", onKey);
      pane.dispose();
    },
  };
}

function formatCode(code: string): string {
  if (code.length !== 6) return code;
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}

function describeDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  if (total < 60) return "Session just started";
  const m = Math.floor(total / 60);
  if (m < 60) return `Session started ${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  return `Session started ${h} hour${h === 1 ? "" : "s"} ago`;
}
