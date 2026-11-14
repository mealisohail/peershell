// Redesigned pairing screen. Same visual language as the landing page.
// Exports a PairingController so main.ts can drive state transitions
// without knowing about the DOM internals.
import "../styles/pairing.css";
import { mountNav, setNavStatus } from "../components/nav.ts";
import { mountCodeInput } from "../components/code-input.ts";
import { mountInstallTerminalBlock } from "../components/install-terminal-block.ts";
import type { SessionMode } from "../terminal/types.ts";

export type PairingState =
  | { kind: "idle" }
  | { kind: "connecting" }
  | {
      kind: "preview";
      mode: SessionMode;
      hostname: string | null;
      onConfirm: () => void;
      onCancel: () => void;
    }
  | { kind: "error"; message: string };

export type PairingController = {
  setState(state: PairingState): void;
  reset(): void;
};

const FEATURE_BADGES = [
  "Peer-to-peer",
  "Encrypted by default",
  "No tunnel",
  "Open source",
];

export function mountPairing(
  root: HTMLElement,
  onSubmit: (code: string) => void,
): PairingController {
  root.innerHTML = `
    <div data-nav-host></div>
    <section class="section section--paper pairing">
      <div class="container pairing__inner">
        <div class="kicker">
          <span class="kicker__dot"></span>
          <span class="kicker__text">ENTER A PAIRING CODE</span>
        </div>

        <h1 class="display pairing__title">
          Got a code? <em>Type it in.</em>
        </h1>

        <p class="lead pairing__lead">
          The host's terminal prints a 6-digit code. Type it here to open a
          peer-to-peer session.
        </p>

        <div class="pairing__input" data-code-host></div>

        <div
          class="pairing__status"
          data-status
          role="status"
          aria-live="polite"
        ></div>

        <ul class="check-row pairing__checks">
          ${FEATURE_BADGES.map(
            (b) =>
              `<li class="check"><span class="check__mark">✓</span>${b}</li>`,
          ).join("")}
        </ul>

        <div class="pairing__install" data-install-host></div>
      </div>

      <div class="pairing__preview" data-preview hidden role="dialog" aria-modal="false" aria-label="Confirm connection">
        <div class="pairing__preview-card">
          <div class="pairing__preview-kicker" data-preview-kicker></div>
          <h2 class="pairing__preview-title" data-preview-title>Agent ready</h2>
          <p class="pairing__preview-host" data-preview-host></p>
          <p class="pairing__preview-explainer" data-preview-explainer></p>
          <div class="pairing__preview-actions">
            <button class="pairing__preview-btn pairing__preview-btn--ghost" type="button" data-preview-cancel>
              Cancel
            </button>
            <button class="pairing__preview-btn pairing__preview-btn--primary" type="button" data-preview-confirm>
              Connect
            </button>
          </div>
        </div>
      </div>
    </section>
  `;

  const navHost = root.querySelector<HTMLElement>("[data-nav-host]")!;
  mountNav(navHost, "app");

  const status = root.querySelector<HTMLElement>("[data-status]")!;
  const codeHost = root.querySelector<HTMLElement>("[data-code-host]")!;
  const installHost = root.querySelector<HTMLElement>("[data-install-host]")!;
  const previewEl = root.querySelector<HTMLElement>("[data-preview]")!;
  const previewKicker = root.querySelector<HTMLElement>("[data-preview-kicker]")!;
  const previewTitle = root.querySelector<HTMLElement>("[data-preview-title]")!;
  const previewHost = root.querySelector<HTMLElement>("[data-preview-host]")!;
  const previewExplainer = root.querySelector<HTMLElement>(
    "[data-preview-explainer]",
  )!;
  const previewConfirm = root.querySelector<HTMLButtonElement>(
    "[data-preview-confirm]",
  )!;
  const previewCancel = root.querySelector<HTMLButtonElement>(
    "[data-preview-cancel]",
  )!;

  // Re-bound on every preview state — keep the latest callbacks live.
  let confirmHandler: (() => void) | null = null;
  let cancelHandler: (() => void) | null = null;
  previewConfirm.addEventListener("click", () => confirmHandler?.());
  previewCancel.addEventListener("click", () => cancelHandler?.());

  const input = mountCodeInput(codeHost, {
    onSubmit: (code) => {
      setState({ kind: "connecting" });
      onSubmit(code);
    },
  });

  mountInstallTerminalBlock(installHost, {
    heading: "New here? Install the agent first.",
    subline: "Run this on the machine you want to share.",
    command: "curl -fsSL peershell.app/install.sh | sh",
  });

  function hidePreview(): void {
    previewEl.hidden = true;
    previewEl.classList.remove("is-open");
    confirmHandler = null;
    cancelHandler = null;
  }

  function showPreview(
    mode: SessionMode,
    hostname: string | null,
    onConfirm: () => void,
    onCancel: () => void,
  ): void {
    const isViewOnly = mode === "view-only";
    previewKicker.innerHTML = isViewOnly
      ? `<span class="pairing__preview-pill pairing__preview-pill--view">◌ View only</span>`
      : `<span class="pairing__preview-pill pairing__preview-pill--full">● Full access</span>`;
    previewTitle.textContent = isViewOnly
      ? "Read-only session"
      : "Ready to connect";
    previewHost.textContent = hostname ? `Host: ${hostname}` : "";
    previewHost.classList.toggle("is-empty", !hostname);
    previewExplainer.textContent = isViewOnly
      ? "Your keystrokes won't be sent to the host. You can still scroll, select text, copy, and search."
      : "You'll be able to type, run commands, and interact with the host's shell.";
    confirmHandler = onConfirm;
    cancelHandler = onCancel;
    previewEl.hidden = false;
    requestAnimationFrame(() => {
      previewEl.classList.add("is-open");
      previewConfirm.focus();
    });
  }

  function setState(state: PairingState): void {
    status.classList.remove("is-error", "is-busy");
    switch (state.kind) {
      case "idle":
        hidePreview();
        status.textContent = "";
        input.setDisabled(false);
        setNavStatus(navHost, "ready");
        return;
      case "connecting":
        hidePreview();
        status.textContent = "Looking for agent…";
        status.classList.add("is-busy");
        input.setDisabled(true);
        setNavStatus(navHost, "connecting");
        return;
      case "preview":
        status.textContent = "";
        input.setDisabled(true);
        setNavStatus(navHost, "connecting");
        showPreview(state.mode, state.hostname, state.onConfirm, state.onCancel);
        return;
      case "error":
        hidePreview();
        status.textContent = state.message;
        status.classList.add("is-error");
        input.setDisabled(false);
        input.focus();
        setNavStatus(navHost, "disconnected");
        return;
    }
  }

  function reset(): void {
    input.clear();
    setState({ kind: "idle" });
  }

  return { setState, reset };
}
