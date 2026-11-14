// Shared types for the terminal-app rewrite (tabs, sessions, panes).
// No runtime code lives here — keep this file dependency-free so it can
// be imported by tests, state, components without cycles.

export type SessionStatus =
  | "pairing"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

/** Permission mode for a session, advertised by the agent at register
 * time and forwarded to the viewer via agent-ready. */
export type SessionMode = "full" | "view-only";

/** A single 8-swatch color (or "none") that a tab can adopt. */
export type TabColor =
  | "slate"
  | "red"
  | "amber"
  | "green"
  | "cyan"
  | "blue"
  | "purple"
  | "pink"
  | null;

export const TAB_COLORS: Record<NonNullable<TabColor>, string> = {
  slate: "#94a3b8",
  red: "#f87171",
  amber: "#fbbf24",
  green: "#34d399",
  cyan: "#22d3ee",
  blue: "#60a5fa",
  purple: "#a78bfa",
  pink: "#f472b6",
};

export type ThemeName =
  | "peershell-dark"
  | "peershell-light"
  | "solarized-dark"
  | "tokyo-night";

export type FontFamily =
  | "geist-mono"
  | "jetbrains-mono"
  | "fira-code"
  | "ibm-plex-mono"
  | "system-mono";

export type FontSettings = {
  family: FontFamily;
  size: number; // px, clamped 10..24
  lineHeight: number; // clamped 1.0..1.6
  ligatures: boolean;
};

export type SplitOrientation = "horizontal" | "vertical";

/** Recursive pane node. A leaf binds to one session via its sessionId. */
export type PaneNode =
  | {
      kind: "leaf";
      id: string;
      sessionId: string;
    }
  | {
      kind: "split";
      id: string;
      orientation: SplitOrientation;
      /** Fraction allocated to the first child, 0..1. */
      ratio: number;
      children: [PaneNode, PaneNode];
    };

/** Per-pane search state — runtime only (not persisted). */
export type SearchState = {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
};

export const DEFAULT_SEARCH_STATE: SearchState = {
  query: "",
  caseSensitive: false,
  wholeWord: false,
  regex: false,
};

/** Globally-persisted search toggle preferences. The query itself is not
 * persisted across reloads, only the user's preferred toggle combination. */
export type SearchPrefs = {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
};

export const DEFAULT_SEARCH_PREFS: SearchPrefs = {
  caseSensitive: false,
  wholeWord: false,
  regex: false,
};

/** Persisted tab snapshot — only the bits that survive a reload. */
export type PersistedTab = {
  id: string;
  title: string;
  color: TabColor;
  /**
   * The original session this tab was tied to. After a reload the session
   * is gone; we keep the id only so we can reconstruct same-session visual
   * grouping if the user re-pairs and offers to "reattach" sibling tabs.
   */
  originalSessionId: string;
};

export type PersistedState = {
  tabs: PersistedTab[];
  activeTabId: string | null;
  settings: FontSettings & { theme: ThemeName };
  /** Last opened section in the settings drawer (UX nicety). */
  lastSettingsSection: string | null;
  /** Last search toggle combination the user chose. */
  searchPrefs: SearchPrefs;
};

export const DEFAULT_FONT_SETTINGS: FontSettings = {
  family: "geist-mono",
  size: 14,
  lineHeight: 1.2,
  ligatures: false,
};

export const DEFAULT_THEME: ThemeName = "peershell-dark";
