// Command registry — pure data + dispatchers. Built fresh each time the
// palette opens so commands reflect the current app state (active tab,
// session status, theme, etc).

import type { ThemeName, TabColor } from "./types.ts";
import { TAB_COLORS } from "./types.ts";

export type CommandCategory =
  | "Tabs"
  | "Splits"
  | "Search"
  | "Sessions"
  | "Appearance"
  | "General";

export type Command = {
  id: string;
  label: string;
  category: CommandCategory;
  /** Optional keyboard hint, e.g. "⌘T". */
  kbd?: string;
  /** Optional short hint shown right of the label (e.g. session code). */
  hint?: string;
  action: () => void;
  /** When false, the command is shown disabled. Defaults to true. */
  enabled?: boolean;
};

export type CommandBuilderContext = {
  activeTabId: string | null;
  activeTabTitle: string | null;
  activeSession: {
    id: string;
    code: string;
    hostname: string | null;
  } | null;
  /** Index of leaves in the active tab. >1 means splits exist. */
  paneCount: number;
  /** Tabs ordered as in the bar — first 9 get switch-to commands. */
  tabs: Array<{ id: string; title: string }>;
  currentTheme: ThemeName;
  currentFontSize: number;

  // ── action dispatchers ────────────────────────────────────────────────
  actions: {
    newTabNewSession: () => void;
    newTabSameSession: () => void;
    closeActiveTab: () => void;
    renameActiveTab: () => void;
    setActiveTabColor: (color: TabColor) => void;
    duplicateActiveTab: () => void;

    splitVertical: () => void;
    splitHorizontal: () => void;
    closeFocusedPane: () => void;
    focusNextPane: () => void;

    openSearch: () => void;
    findNext: () => void;
    findPrevious: () => void;

    switchToTab: (tabId: string) => void;
    reconnectActiveSession: () => void;
    disconnectActiveSession: () => void;

    setTheme: (name: ThemeName) => void;
    toggleTheme: () => void;
    increaseFontSize: () => void;
    decreaseFontSize: () => void;
    resetFontSize: () => void;

    openSettings: () => void;
    openKeyboardReference: () => void;
    copyPairingCode: () => void;
    copySessionInfo: () => void;
  };
};

const THEME_LABELS: Record<ThemeName, string> = {
  "peershell-dark": "Peershell Dark",
  "peershell-light": "Peershell Light",
  "solarized-dark": "Solarized Dark",
  "tokyo-night": "Tokyo Night",
};

const COLOR_LABELS: Record<NonNullable<TabColor>, string> = {
  slate: "Slate",
  red: "Red",
  amber: "Amber",
  green: "Green",
  cyan: "Cyan",
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
};

export function buildCommands(ctx: CommandBuilderContext): Command[] {
  const out: Command[] = [];
  const inSession = ctx.activeSession !== null;

  // ── Tabs ───────────────────────────────────────────────────────────────
  out.push(
    {
      id: "tab.new",
      label: "New tab — new session",
      category: "Tabs",
      kbd: "⌘T",
      action: ctx.actions.newTabNewSession,
    },
    {
      id: "tab.new-same",
      label: "New tab — same session",
      category: "Tabs",
      kbd: "⌘⇧T",
      enabled: inSession,
      action: ctx.actions.newTabSameSession,
    },
    {
      id: "tab.duplicate",
      label: "Duplicate tab (same session)",
      category: "Tabs",
      enabled: inSession,
      action: ctx.actions.duplicateActiveTab,
    },
    {
      id: "tab.rename",
      label: "Rename current tab",
      category: "Tabs",
      enabled: ctx.activeTabId !== null,
      action: ctx.actions.renameActiveTab,
    },
    {
      id: "tab.close",
      label: "Close current tab",
      category: "Tabs",
      kbd: "⌘W",
      enabled: ctx.activeTabId !== null,
      action: ctx.actions.closeActiveTab,
    },
  );

  // Color swatches expanded as 9 commands (8 + clear).
  for (const color of Object.keys(COLOR_LABELS) as Array<NonNullable<TabColor>>) {
    out.push({
      id: `tab.color.${color}`,
      label: `Set tab color: ${COLOR_LABELS[color]}`,
      category: "Tabs",
      enabled: ctx.activeTabId !== null,
      hint: TAB_COLORS[color],
      action: () => ctx.actions.setActiveTabColor(color),
    });
  }
  out.push({
    id: "tab.color.none",
    label: "Clear tab color",
    category: "Tabs",
    enabled: ctx.activeTabId !== null,
    action: () => ctx.actions.setActiveTabColor(null),
  });

  // ── Splits ────────────────────────────────────────────────────────────
  out.push(
    {
      id: "split.v",
      label: "Split pane vertically",
      category: "Splits",
      kbd: "⌘D",
      enabled: inSession,
      action: ctx.actions.splitVertical,
    },
    {
      id: "split.h",
      label: "Split pane horizontally",
      category: "Splits",
      kbd: "⌘⇧D",
      enabled: inSession,
      action: ctx.actions.splitHorizontal,
    },
    {
      id: "split.close",
      label: "Close focused pane",
      category: "Splits",
      kbd: "⌘W",
      enabled: ctx.paneCount > 1,
      action: ctx.actions.closeFocusedPane,
    },
    {
      id: "split.focus-next",
      label: "Focus next pane",
      category: "Splits",
      kbd: "⌘⌥→",
      enabled: ctx.paneCount > 1,
      action: ctx.actions.focusNextPane,
    },
  );

  // ── Search ────────────────────────────────────────────────────────────
  out.push(
    {
      id: "search.open",
      label: "Find in terminal",
      category: "Search",
      kbd: "⌘F",
      enabled: inSession,
      action: ctx.actions.openSearch,
    },
    {
      id: "search.next",
      label: "Find next",
      category: "Search",
      kbd: "⌘G",
      enabled: inSession,
      action: ctx.actions.findNext,
    },
    {
      id: "search.prev",
      label: "Find previous",
      category: "Search",
      kbd: "⌘⇧G",
      enabled: inSession,
      action: ctx.actions.findPrevious,
    },
  );

  // ── Sessions ──────────────────────────────────────────────────────────
  ctx.tabs.slice(0, 9).forEach((tab, idx) => {
    out.push({
      id: `session.switch.${tab.id}`,
      label: `Switch to tab ${idx + 1}: ${tab.title}`,
      category: "Sessions",
      kbd: `⌘${idx + 1}`,
      action: () => ctx.actions.switchToTab(tab.id),
    });
  });
  out.push(
    {
      id: "session.reconnect",
      label: "Reconnect current session",
      category: "Sessions",
      enabled: inSession,
      action: ctx.actions.reconnectActiveSession,
    },
    {
      id: "session.disconnect",
      label: "Disconnect current session",
      category: "Sessions",
      enabled: inSession,
      action: ctx.actions.disconnectActiveSession,
    },
  );

  // ── Appearance ────────────────────────────────────────────────────────
  out.push({
    id: "appearance.theme.toggle",
    label: "Toggle theme (next in cycle)",
    category: "Appearance",
    action: ctx.actions.toggleTheme,
  });
  for (const theme of Object.keys(THEME_LABELS) as ThemeName[]) {
    out.push({
      id: `appearance.theme.${theme}`,
      label: `Set theme: ${THEME_LABELS[theme]}`,
      category: "Appearance",
      hint: ctx.currentTheme === theme ? "active" : undefined,
      action: () => ctx.actions.setTheme(theme),
    });
  }
  out.push(
    {
      id: "appearance.font.inc",
      label: "Increase font size",
      category: "Appearance",
      kbd: "⌘+",
      hint: `${ctx.currentFontSize} px`,
      action: ctx.actions.increaseFontSize,
    },
    {
      id: "appearance.font.dec",
      label: "Decrease font size",
      category: "Appearance",
      kbd: "⌘-",
      hint: `${ctx.currentFontSize} px`,
      action: ctx.actions.decreaseFontSize,
    },
    {
      id: "appearance.font.reset",
      label: "Reset font size",
      category: "Appearance",
      kbd: "⌘0",
      action: ctx.actions.resetFontSize,
    },
  );

  // ── General ───────────────────────────────────────────────────────────
  out.push(
    {
      id: "general.settings",
      label: "Open settings",
      category: "General",
      kbd: "⌘,",
      action: ctx.actions.openSettings,
    },
    {
      id: "general.kbd",
      label: "View keyboard shortcuts",
      category: "General",
      kbd: "⌘/",
      action: ctx.actions.openKeyboardReference,
    },
    {
      id: "general.copy-code",
      label: "Copy pairing code",
      category: "General",
      enabled: inSession,
      hint: ctx.activeSession ? formatCode(ctx.activeSession.code) : undefined,
      action: ctx.actions.copyPairingCode,
    },
    {
      id: "general.copy-info",
      label: "Copy session info",
      category: "General",
      enabled: inSession,
      action: ctx.actions.copySessionInfo,
    },
  );

  return out;
}

function formatCode(code: string): string {
  if (code.length !== 6) return code;
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

/**
 * Very small fuzzy matcher. Returns null if the query doesn't match, else
 * a numeric score (lower = better). The matching rule: every character of
 * the query must appear in label order, case-insensitive. Score rewards
 * tight matches, word-start matches, and short labels.
 */
export function fuzzyMatch(label: string, query: string): number | null {
  if (!query) return 0;
  const q = query.toLowerCase();
  const lab = label.toLowerCase();

  // Exact substring → very good score.
  const subIdx = lab.indexOf(q);
  if (subIdx !== -1) {
    return subIdx * 2 + label.length * 0.1; // earlier hits + shorter labels win
  }

  // Fuzzy subsequence match.
  let li = 0;
  let lastHit = -1;
  let score = 0;
  for (const ch of q) {
    const found = lab.indexOf(ch, li);
    if (found === -1) return null;
    // Reward word boundaries.
    const isWordStart = found === 0 || /[\s\-_/]/.test(lab.charAt(found - 1));
    score += isWordStart ? 0 : found - li + 1;
    lastHit = found;
    li = found + 1;
  }
  // Penalise long labels slightly so concise matches surface first.
  return score + (label.length - lastHit) * 0.05 + 200;
}
