// SettingsDrawer — slide-in panel from the right (~360px). Phase D ships
// only the Appearance section (theme picker). Sessions / connection /
// shortcuts / about sections are placeholders that future phases fill in.
import "../../styles/settings-drawer.css";
import type { ThemeProvider } from "../ThemeProvider.ts";
import { mountThemePicker } from "./ThemePicker.ts";
import { mountFontControls } from "./FontControls.ts";
import type { Store } from "../../state/store.ts";
import type { SessionMode } from "../types.ts";

export type ActiveSessionInfo = {
  hostname: string | null;
  code: string;
  mode: SessionMode;
};

/**
 * Caller-supplied resolver — returns whatever the active tab's session is
 * right now, or null when no session is live. Polled each time the
 * Connection section is opened.
 */
export type SessionInfoResolver = () => ActiveSessionInfo | null;

export type SettingsDrawerController = {
  /** Open the drawer. Optional section name jumps to it on open. */
  open(section?: string): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  dispose(): void;
};

export type SettingsDrawerOptions = {
  themes: ThemeProvider;
  store: Store;
  /** Optional — used to populate the Connection section. */
  getActiveSession?: SessionInfoResolver;
};

const CLOSE_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

export function mountSettingsDrawer(
  root: HTMLElement,
  opts: SettingsDrawerOptions,
): SettingsDrawerController {
  const wrap = document.createElement("div");
  wrap.className = "drawer-wrap";
  wrap.hidden = true;
  wrap.innerHTML = `
    <div class="drawer-wrap__backdrop" data-backdrop></div>
    <aside class="drawer" role="dialog" aria-modal="false" aria-label="Settings">
      <header class="drawer__head">
        <h2 class="drawer__title">Settings</h2>
        <button class="drawer__close" type="button" data-close aria-label="Close settings">
          ${CLOSE_ICON}
        </button>
      </header>
      <nav class="drawer__nav" aria-label="Settings sections">
        <button class="drawer__nav-item is-active" type="button" data-section="appearance">Appearance</button>
        <button class="drawer__nav-item" type="button" data-section="sessions">Sessions</button>
        <button class="drawer__nav-item" type="button" data-section="connection">Connection</button>
        <button class="drawer__nav-item" type="button" data-section="keyboard">Keyboard shortcuts</button>
        <button class="drawer__nav-item" type="button" data-section="about">About</button>
      </nav>
      <div class="drawer__body" data-body></div>
    </aside>
  `;
  root.appendChild(wrap);

  const backdrop = wrap.querySelector<HTMLElement>("[data-backdrop]")!;
  const closeBtn = wrap.querySelector<HTMLButtonElement>("[data-close]")!;
  const body = wrap.querySelector<HTMLElement>("[data-body]")!;
  const navItems = wrap.querySelectorAll<HTMLButtonElement>("[data-section]");

  let isOpen = false;
  let activeSection: string = "appearance";
  let unsubPicker: (() => void) | null = null;
  let unsubFont: (() => void) | null = null;

  function renderSection(section: string): void {
    activeSection = section;
    navItems.forEach((b) => {
      b.classList.toggle("is-active", b.dataset["section"] === section);
    });
    if (unsubPicker) {
      unsubPicker();
      unsubPicker = null;
    }
    if (unsubFont) {
      unsubFont();
      unsubFont = null;
    }
    body.innerHTML = "";
    if (section === "appearance") {
      const themeHead = document.createElement("h3");
      themeHead.className = "drawer__section-head";
      themeHead.textContent = "Theme";
      body.appendChild(themeHead);
      const pickerHost = document.createElement("div");
      body.appendChild(pickerHost);
      unsubPicker = mountThemePicker(pickerHost, opts.themes);

      const fontHead = document.createElement("h3");
      fontHead.className = "drawer__section-head drawer__section-head--gap";
      fontHead.textContent = "Font";
      body.appendChild(fontHead);
      const fontHost = document.createElement("div");
      body.appendChild(fontHost);
      unsubFont = mountFontControls(fontHost, opts.store);
    } else if (section === "keyboard") {
      renderKeyboardReference(body);
    } else if (section === "connection") {
      renderConnection(body);
    } else {
      const placeholder = document.createElement("p");
      placeholder.className = "drawer__placeholder";
      placeholder.textContent = `${labelFor(section)} — coming soon.`;
      body.appendChild(placeholder);
    }
  }

  function renderConnection(host: HTMLElement): void {
    const info = opts.getActiveSession?.() ?? null;
    if (!info) {
      const empty = document.createElement("p");
      empty.className = "drawer__placeholder";
      empty.textContent = "No active session.";
      host.appendChild(empty);
      return;
    }
    const formatCode = (c: string): string =>
      c.length === 6 ? `${c.slice(0, 3)}-${c.slice(3)}` : c;
    const modeLabel =
      info.mode === "view-only" ? "View only (read-only)" : "Full access";
    const modeClass = info.mode === "view-only" ? "is-view" : "is-full";
    host.innerHTML = `
      <h3 class="drawer__section-head">Active session</h3>
      <dl class="kbdref">
        <div class="kbdref__row"><dt>Host</dt><dd>${escape(info.hostname ?? "—")}</dd></div>
        <div class="kbdref__row"><dt>Code</dt><dd><kbd>${escape(formatCode(info.code))}</kbd></dd></div>
        <div class="kbdref__row"><dt>Mode</dt><dd><span class="drawer__mode-pill ${modeClass}">${modeLabel}</span></dd></div>
      </dl>
    `;
  }

  function renderKeyboardReference(host: HTMLElement): void {
    const groups: Array<{ label: string; rows: Array<[string, string]> }> = [
      {
        label: "Tabs",
        rows: [
          ["New tab — new session", "⌘T"],
          ["New tab — same session", "⌘⇧T"],
          ["Close current pane (or tab)", "⌘W"],
          ["Switch to tab 1–9", "⌘1–9"],
          ["Open command palette", "⌘K"],
        ],
      },
      {
        label: "Splits",
        rows: [
          ["Split vertically (side-by-side)", "⌘D"],
          ["Split horizontally (stacked)", "⌘⇧D"],
          ["Focus adjacent pane", "⌘⌥←↑↓→"],
        ],
      },
      {
        label: "Search",
        rows: [
          ["Find in terminal", "⌘F"],
          ["Find next", "⌘G"],
          ["Find previous", "⌘⇧G"],
          ["Close search", "Esc"],
        ],
      },
      {
        label: "Font",
        rows: [
          ["Increase font size", "⌘+"],
          ["Decrease font size", "⌘−"],
          ["Reset font size", "⌘0"],
        ],
      },
      {
        label: "App",
        rows: [
          ["Open settings", "⌘,"],
          ["Open command palette", "⌘K"],
        ],
      },
    ];
    host.innerHTML = groups
      .map(
        (g) => `
        <h3 class="drawer__section-head drawer__section-head--gap">${g.label}</h3>
        <dl class="kbdref">
          ${g.rows
            .map(
              ([label, kbd]) =>
                `<div class="kbdref__row"><dt>${label}</dt><dd><kbd>${kbd}</kbd></dd></div>`,
            )
            .join("")}
        </dl>
      `,
      )
      .join("");
    const note = document.createElement("p");
    note.className = "drawer__note";
    note.textContent =
      "On Linux/Windows, ⌘ → Ctrl and ⌥ → Alt. Shortcuts work everywhere except inside text inputs.";
    host.appendChild(note);
  }

  function labelFor(section: string): string {
    switch (section) {
      case "sessions":
        return "Sessions";
      case "connection":
        return "Connection";
      case "keyboard":
        return "Keyboard shortcuts";
      case "about":
        return "About";
      default:
        return section;
    }
  }

  navItems.forEach((btn) => {
    btn.addEventListener("click", () => {
      const section = btn.dataset["section"]!;
      renderSection(section);
    });
  });

  function open(section?: string): void {
    if (section && section !== activeSection) {
      renderSection(section);
    }
    if (isOpen) return;
    isOpen = true;
    wrap.hidden = false;
    requestAnimationFrame(() => {
      wrap.classList.add("is-open");
      if (activeSection === "appearance" && !unsubPicker) {
        renderSection("appearance");
      }
    });
  }

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    wrap.classList.remove("is-open");
    setTimeout(() => {
      wrap.hidden = true;
    }, 220);
  }

  function toggle(): void {
    if (isOpen) close();
    else open();
  }

  closeBtn.addEventListener("click", close);
  backdrop.addEventListener("click", close);
  const onKey = (ev: KeyboardEvent): void => {
    if (isOpen && ev.key === "Escape") {
      ev.preventDefault();
      close();
    }
  };
  document.addEventListener("keydown", onKey);

  renderSection("appearance");

  return {
    open,
    close,
    toggle,
    isOpen: () => isOpen,
    dispose: () => {
      unsubPicker?.();
      unsubFont?.();
      document.removeEventListener("keydown", onKey);
      wrap.remove();
    },
  };
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
