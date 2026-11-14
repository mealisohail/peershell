// Top app bar (32–36px). Wordmark left, command-palette trigger middle,
// settings gear + active-session status pill + mode pill right.
import type { SessionMode, SessionStatus } from "./types.ts";

export type AppBarController = {
  setStatus(status: SessionStatus, label: string | null): void;
  /** Pass null to hide the mode pill (no active session). */
  setMode(mode: SessionMode | null): void;
  onPaletteClick(handler: () => void): void;
  onSettingsClick(handler: () => void): void;
  onInfoClick(handler: () => void): void;
  /** Anchor element for popovers (diagnostics panel). */
  getInfoButton(): HTMLElement;
};

const COG_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`;

const SEARCH_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;

const EYE_ICON = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>`;

const KEY_ICON = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>`;

const INFO_ICON = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;

export function mountAppBar(host: HTMLElement): AppBarController {
  host.innerHTML = `
    <header class="appbar">
      <a class="appbar__brand" href="/">peershell</a>

      <button class="appbar__palette" type="button" data-palette>
        <span class="appbar__palette-icon">${SEARCH_ICON}</span>
        <span class="appbar__palette-label">Search or run a command</span>
        <span class="appbar__palette-kbd">⌘K</span>
      </button>

      <div class="appbar__right">
        <span class="appbar__status" data-status>
          <span class="appbar__status-dot" data-status-dot></span>
          <span class="appbar__status-text" data-status-text>Not connected</span>
          <button class="appbar__status-info" type="button" data-info aria-label="Connection details" title="Connection details">
            ${INFO_ICON}
          </button>
        </span>
        <span class="appbar__mode" data-mode hidden></span>
        <button class="appbar__settings" type="button" data-settings aria-label="Settings">
          ${COG_ICON}
        </button>
      </div>
    </header>
  `;

  const dot = host.querySelector<HTMLElement>("[data-status-dot]")!;
  const text = host.querySelector<HTMLElement>("[data-status-text]")!;
  const statusEl = host.querySelector<HTMLElement>("[data-status]")!;
  const modeEl = host.querySelector<HTMLElement>("[data-mode]")!;
  const paletteBtn = host.querySelector<HTMLElement>("[data-palette]")!;
  const settingsBtn = host.querySelector<HTMLElement>("[data-settings]")!;
  const infoBtn = host.querySelector<HTMLButtonElement>("[data-info]")!;

  let paletteHandler: (() => void) | null = null;
  let settingsHandler: (() => void) | null = null;
  let infoHandler: (() => void) | null = null;
  paletteBtn.addEventListener("click", () => paletteHandler?.());
  settingsBtn.addEventListener("click", () => settingsHandler?.());
  infoBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    infoHandler?.();
  });

  return {
    setStatus: (status, label) => {
      statusEl.classList.remove(
        "appbar__status--pairing",
        "appbar__status--connecting",
        "appbar__status--connected",
        "appbar__status--disconnected",
        "appbar__status--error",
      );
      statusEl.classList.add(`appbar__status--${status}`);
      void dot; // class on parent drives styling
      text.textContent = label ?? statusLabel(status);
    },
    setMode: (mode) => {
      if (!mode) {
        modeEl.hidden = true;
        modeEl.innerHTML = "";
        modeEl.classList.remove("appbar__mode--full", "appbar__mode--view");
        return;
      }
      modeEl.hidden = false;
      modeEl.classList.toggle("appbar__mode--full", mode === "full");
      modeEl.classList.toggle("appbar__mode--view", mode === "view-only");
      modeEl.title =
        mode === "view-only"
          ? "View-only session — your keystrokes are not sent to the host"
          : "Full access — your keystrokes flow to the host's shell";
      modeEl.innerHTML = `
        <span class="appbar__mode-icon">${
          mode === "view-only" ? EYE_ICON : KEY_ICON
        }</span>
        <span class="appbar__mode-text">${
          mode === "view-only" ? "View only" : "Full access"
        }</span>
      `;
    },
    onPaletteClick: (handler) => {
      paletteHandler = handler;
    },
    onSettingsClick: (handler) => {
      settingsHandler = handler;
    },
    onInfoClick: (handler) => {
      infoHandler = handler;
    },
    getInfoButton: () => infoBtn,
  };
}

function statusLabel(status: SessionStatus): string {
  switch (status) {
    case "pairing":
      return "Enter a code";
    case "connecting":
      return "Connecting…";
    case "connected":
      return "Connected";
    case "disconnected":
      return "Disconnected";
    case "error":
      return "Error";
  }
}
