// TerminalPane — one xterm.js instance bound to a Session.
//
// Behaviour:
//   • Subscribes to session.onOutput → term.write
//   • Replays session.outputBuffer.snapshot() into the term on mount so a
//     newly-attached pane sees the same backlog the original tab saw
//   • Keystrokes from xterm only flow to the wire when this pane is the
//     session's focus owner (Session.focusedAttachmentId === this.attachmentId)
//   • Resize events from xterm always send a control frame — the host PTY
//     needs to know the smallest visible cols × rows
//
// Phase B: only one pane per session in the UI, so the focus check is
// trivially always-true. The check exists so phase C+ multi-attach works
// without further changes here.
import "@xterm/xterm/css/xterm.css";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon, type ISearchOptions } from "@xterm/addon-search";
import type { Session } from "./Session.ts";
import type { TerminalConnection } from "./TerminalConnection.ts";
import { FONT_FAMILIES } from "./fonts.ts";
import type { FontSettings, SearchPrefs } from "./types.ts";

export type SearchResultInfo = { resultIndex: number; resultCount: number };

export type TerminalPaneController = {
  /** Manually run a fit pass — used after layout shifts (drawer open, etc). */
  fit(): void;
  focus(): void;
  /** Apply a new xterm theme (called by ThemeProvider on theme switch). */
  setTheme(theme: ITheme): void;
  /** Apply font family / size / line height / ligatures live. */
  setFont(settings: FontSettings): void;
  /** Jump to next/previous match for `query` with the given toggle prefs. */
  findNext(query: string, prefs: SearchPrefs): boolean;
  findPrevious(query: string, prefs: SearchPrefs): boolean;
  /** Remove all search highlight decorations. */
  clearSearch(): void;
  /** Subscribe to search-result changes. Returns an unsubscribe fn. */
  onSearchResults(handler: (info: SearchResultInfo) => void): () => void;
  dispose(): void;
};

export type TerminalPaneOptions = {
  session: Session;
  connection: TerminalConnection;
  /**
   * Unique id for this attachment. Passed to session.attach() so the
   * session can track focus ownership across multiple panes.
   */
  attachmentId: string;
  /** Initial xterm theme — pulled from the active ThemeProvider. */
  theme?: ITheme;
  /** Initial font settings — pulled from the Store. */
  font?: FontSettings;
};

const encoder = new TextEncoder();

export function mountPane(
  host: HTMLElement,
  opts: TerminalPaneOptions,
): TerminalPaneController {
  const { session, connection, attachmentId } = opts;

  // Register this attachment with the session (refcount + focus default).
  session.attach(attachmentId);

  const initialFont = opts.font;
  const fontFamily = initialFont
    ? FONT_FAMILIES[initialFont.family].stack
    : FONT_FAMILIES["geist-mono"].stack;
  const fontSize = initialFont?.size ?? 14;
  const lineHeight = initialFont?.lineHeight ?? 1.2;

  const viewOnly = session.mode === "view-only";

  if (viewOnly) {
    const banner = document.createElement("div");
    banner.className = "pane-viewonly-banner";
    banner.innerHTML = `
      <span class="pane-viewonly-banner__icon" aria-hidden="true">◌</span>
      View-only session — your keystrokes are not sent
    `;
    host.appendChild(banner);
    host.classList.add("pane-view-only");
  }

  const term = new Terminal({
    convertEol: false,
    // View-only: non-blinking outlined cursor to signal "you can't type here"
    // without removing the cursor entirely (search, selection still need it).
    cursorBlink: !viewOnly,
    cursorStyle: viewOnly ? "underline" : "block",
    fontFamily,
    fontSize,
    lineHeight,
    theme: opts.theme ?? {
      background: "#1d1411",
      foreground: "#f0e6d6",
    },
    allowProposedApi: false,
    disableStdin: viewOnly,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  const search = new SearchAddon();
  term.loadAddon(search);
  term.open(host);
  fit.fit();

  // OSC 7 — host shell announces its current working directory as
  //   ESC ] 7 ; file://hostname/path ESC \
  // Bash/zsh users typically wire this via PROMPT_COMMAND; we'll just
  // listen and forward the cwd to the session. Returning true tells xterm
  // we consumed the OSC (it has no default behavior for 7).
  term.parser.registerOscHandler(7, (data) => {
    const cwd = parseOsc7(data);
    if (cwd !== null) session.setCwd(cwd);
    return true;
  });

  // Fallback: many shells set the window title to something like
  //   user@host: ~/path  or  /full/path
  // via OSC 0/1/2. xterm fires onTitleChange for those. Pull a path-shaped
  // tail out and treat it as the cwd. This catches default oh-my-zsh,
  // most bash PS1 setups, and fish — none of which require OSC 7.
  term.onTitleChange((title) => {
    const cwd = extractCwdFromTitle(title);
    if (cwd !== null) session.setCwd(cwd);
  });

  // Replay backlog so the user sees the same state as the original pane.
  // Single batched write — xterm handles the resulting bytes far more
  // efficiently than per-chunk writes during scrollback rebuild.
  const backlog = session.outputBuffer.snapshot();
  if (backlog.length > 0) {
    term.write(backlog);
  }

  // Inbound bytes → xterm.
  const unsubOutput = session.onOutput((chunk) => {
    term.write(chunk);
  });

  // User keystrokes → wire, only when this pane owns focus. We also peek
  // at the keystrokes locally to track `cd` commands as a best-effort cwd
  // source (works on shells that don't emit OSC 7 or update the title).
  let currentLine = "";
  let toastShown = false;
  const dataDisposer = term.onData((input) => {
    if (session.focusedAttachmentId !== attachmentId) return;
    if (viewOnly) {
      // Drop input entirely; show a one-time toast the first time the user
      // tries to type so they understand why nothing happens.
      if (!toastShown) {
        toastShown = true;
        showViewOnlyToast(host);
      }
      return;
    }
    connection.sendInput(encoder.encode(input));
    currentLine = peekCommandLine(currentLine, input, (parsed) => {
      const next = resolvePath(parsed, session.cwd);
      if (next !== null) session.setCwd(next);
    });
  });

  // Track focus on the host element so we can claim ownership when the
  // user clicks/tabs into this pane. xterm's own focus event fires through
  // the host element.
  const focusHandler = (): void => {
    if (session.focusedAttachmentId !== attachmentId) {
      session.setFocus(attachmentId);
    }
  };
  host.addEventListener("focusin", focusHandler);

  // Resize: always send so the host PTY reflows correctly.
  const resizeDisposer = term.onResize(({ cols, rows }) => {
    connection.sendResize(cols, rows);
  });

  // Emit an initial resize once the channel is ready so the PTY's window
  // size matches the rendered terminal before the first keystroke.
  connection.sendResize(term.cols, term.rows);

  // Re-fit on host size changes.
  const observer = new ResizeObserver(() => {
    try {
      fit.fit();
    } catch {
      // observer may fire while the element is detached
    }
  });
  observer.observe(host);

  term.focus();

  function parseOsc7(data: string): string | null {
    // Format: `file://hostname/path/to/cwd` — path is %-encoded.
    if (!data.startsWith("file://")) return null;
    const slash = data.indexOf("/", "file://".length);
    if (slash === -1) return null;
    try {
      return decodeURIComponent(data.slice(slash));
    } catch {
      return data.slice(slash);
    }
  }

  /**
   * Accumulate the user's current command-line buffer. Calls onCdLine(arg)
   * when the user presses Enter on a line that starts with `cd `. Returns
   * the updated buffer. Best-effort — only catches `cd path` at the start
   * of a line; misses pipelines, aliases, scripts, history recall.
   */
  function peekCommandLine(
    buffer: string,
    input: string,
    onCdLine: (arg: string) => void,
  ): string {
    let buf = buffer;
    for (let i = 0; i < input.length; i++) {
      const ch = input.charAt(i);
      const code = input.charCodeAt(i);
      if (ch === "\r" || ch === "\n") {
        const trimmed = buf.trim();
        if (trimmed === "cd") {
          onCdLine("~");
        } else if (trimmed.startsWith("cd ")) {
          // Strip wrapping quotes if any; ignore complex shell syntax beyond
          // a single argument.
          let arg = trimmed.slice(3).trim();
          if (
            (arg.startsWith('"') && arg.endsWith('"')) ||
            (arg.startsWith("'") && arg.endsWith("'"))
          ) {
            arg = arg.slice(1, -1);
          }
          if (arg && !arg.includes(" ") && !arg.includes("&") && !arg.includes("|") && !arg.includes(";")) {
            onCdLine(arg);
          }
        }
        buf = "";
      } else if (ch === "\x7f" || ch === "\b") {
        buf = buf.slice(0, -1);
      } else if (ch === "\x03" || ch === "\x15") {
        // Ctrl-C / Ctrl-U — clear line
        buf = "";
      } else if (ch === "\x1b") {
        // Escape sequence (arrow keys, history nav) — bail to avoid garbage
        // creeping into our buffer. We won't catch `cd` after history recall.
        buf = "";
        // Skip the rest of the escape sequence — usually 2-3 more bytes.
        // Bumping i is fragile; the next call's first char might be the
        // remaining ESC bytes which we'll harmlessly process as junk and
        // reset on next Enter.
      } else if (code >= 32 && code !== 127) {
        buf += ch;
      }
    }
    return buf;
  }

  /**
   * Resolve a cd target against the current cwd. Returns null when we
   * can't compute it (relative path with no base).
   */
  function resolvePath(target: string, current: string | null): string | null {
    if (!target) return null;
    if (target.startsWith("/")) return normalize(target);
    if (target === "~" || target.startsWith("~/")) return normalize(target);
    if (!current) {
      // No base; only absolute / home-relative paths can be resolved.
      return null;
    }
    if (target === ".") return current;
    // Join.
    const joined = current.endsWith("/")
      ? current + target
      : current + "/" + target;
    return normalize(joined);
  }

  function normalize(path: string): string {
    const isHome = path === "~" || path.startsWith("~/");
    const isAbsolute = path.startsWith("/");
    let rest = path;
    if (isHome) {
      rest = path === "~" ? "" : path.slice(2);
    } else if (isAbsolute) {
      rest = path.slice(1);
    }
    const segments: string[] = [];
    for (const seg of rest.split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") {
        if (segments.length > 0) segments.pop();
        else if (!isHome && !isAbsolute) {
          /* trying to go above relative base — keep as is */
        }
      } else {
        segments.push(seg);
      }
    }
    if (isHome) {
      return segments.length === 0 ? "~" : "~/" + segments.join("/");
    }
    if (isAbsolute) {
      return "/" + segments.join("/");
    }
    return segments.join("/");
  }

  function showViewOnlyToast(into: HTMLElement): void {
    const toast = document.createElement("div");
    toast.className = "pane-toast";
    toast.textContent = "View-only — typing disabled";
    into.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("is-visible"));
    setTimeout(() => {
      toast.classList.remove("is-visible");
      setTimeout(() => toast.remove(), 240);
    }, 1800);
  }

  function extractCwdFromTitle(title: string): string | null {
    if (!title) return null;
    // Common patterns we care about:
    //   "user@host: /some/path"   → /some/path
    //   "user@host: ~/path"       → ~/path
    //   "/full/path"              → /full/path
    //   "fish ~/path"             → ~/path
    //   "~/path — vim"            → ~/path  (rare; conservatively skip)
    // Strategy: find the last token that looks path-shaped and return it.
    const candidates = title
      .split(/[\s:|–—]+/)
      .filter((t) => t.startsWith("/") || t.startsWith("~"));
    const last = candidates[candidates.length - 1];
    if (!last) return null;
    // Trim trailing punctuation/quotes that some prompts add.
    return last.replace(/[)\]"'>\s]+$/, "");
  }

  function buildSearchOptions(prefs: SearchPrefs): ISearchOptions {
    const cs = getComputedStyle(document.documentElement);
    const accent = cs.getPropertyValue("--chrome-accent").trim() || "#b8401f";
    return {
      caseSensitive: prefs.caseSensitive,
      wholeWord: prefs.wholeWord,
      regex: prefs.regex,
      decorations: {
        matchBackground: accent + "40", // ~25% alpha for inactive matches
        matchBorder: accent + "60",
        matchOverviewRuler: accent + "80",
        activeMatchBackground: accent,
        activeMatchBorder: accent,
        activeMatchColorOverviewRuler: accent,
      },
    };
  }

  return {
    fit: () => {
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
    },
    focus: () => term.focus(),
    setTheme: (next) => {
      term.options.theme = next;
    },
    setFont: (next) => {
      term.options.fontFamily = FONT_FAMILIES[next.family].stack;
      term.options.fontSize = next.size;
      term.options.lineHeight = next.lineHeight;
      // Ligatures: xterm's canvas renderer doesn't honor these without
      // the @xterm/addon-ligatures addon (not in v1 scope). Toggle
      // persists and applies once the addon ships.
      try {
        fit.fit();
      } catch {
        /* ignore */
      }
    },
    findNext: (query, prefs) => search.findNext(query, buildSearchOptions(prefs)),
    findPrevious: (query, prefs) =>
      search.findPrevious(query, buildSearchOptions(prefs)),
    clearSearch: () => search.clearDecorations(),
    onSearchResults: (handler) => {
      const sub = search.onDidChangeResults(handler);
      return () => sub.dispose();
    },
    dispose: () => {
      observer.disconnect();
      dataDisposer.dispose();
      resizeDisposer.dispose();
      unsubOutput();
      host.removeEventListener("focusin", focusHandler);
      term.dispose();
      session.detach(attachmentId);
    },
  };
}
