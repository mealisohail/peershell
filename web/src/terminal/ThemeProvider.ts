// ThemeProvider — owns the active theme name. Two responsibilities:
//
//   1. Apply `data-theme="<name>"` to <html> and persist via the Store.
//   2. Provide an xterm-shaped theme object derived from the live CSS
//      variables (so themes have a single source of truth in the CSS files).
//
// Live panes subscribe to onChange and re-apply the xterm theme; chrome
// re-skins automatically via CSS variable changes.
import type { Store } from "../state/store.ts";
import type { ThemeName } from "./types.ts";

export type XtermTheme = {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
};

type Listener = (theme: ThemeName) => void;

export class ThemeProvider {
  private readonly store: Store;
  private readonly listeners = new Set<Listener>();
  private unsubscribeStore: () => void;
  private lastApplied: ThemeName | null = null;

  constructor(store: Store) {
    this.store = store;
    this.apply(store.snapshot().settings.theme);
    this.unsubscribeStore = store.subscribe((state) => {
      if (state.settings.theme !== this.lastApplied) {
        this.apply(state.settings.theme);
      }
    });
  }

  current(): ThemeName {
    return this.store.snapshot().settings.theme;
  }

  set(theme: ThemeName): void {
    this.store.setTheme(theme);
    // The store subscription will apply + notify; nothing else to do here.
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Read the current theme's xterm color palette directly from CSS
   * variables. Call this after the data-theme attribute has been applied;
   * the values are computed live.
   */
  getXtermTheme(): XtermTheme {
    const cs = getComputedStyle(document.documentElement);
    const v = (name: string): string => cs.getPropertyValue(name).trim();
    return {
      background: v("--term-bg"),
      foreground: v("--term-fg"),
      cursor: v("--term-cursor"),
      cursorAccent: v("--term-bg"),
      selectionBackground: v("--term-selection"),
      black: v("--term-black"),
      red: v("--term-red"),
      green: v("--term-green"),
      yellow: v("--term-yellow"),
      blue: v("--term-blue"),
      magenta: v("--term-magenta"),
      cyan: v("--term-cyan"),
      white: v("--term-white"),
      brightBlack: v("--term-bright-black"),
      brightRed: v("--term-bright-red"),
      brightGreen: v("--term-bright-green"),
      brightYellow: v("--term-bright-yellow"),
      brightBlue: v("--term-bright-blue"),
      brightMagenta: v("--term-bright-magenta"),
      brightCyan: v("--term-bright-cyan"),
      brightWhite: v("--term-bright-white"),
    };
  }

  dispose(): void {
    this.unsubscribeStore();
    this.listeners.clear();
  }

  private apply(theme: ThemeName): void {
    document.documentElement.dataset["theme"] = theme;
    this.lastApplied = theme;
    // Defer notify by one frame so subscribers reading getXtermTheme() see
    // the new CSS values (the browser has had a chance to apply the data
    // attribute change to the computed styles by then).
    requestAnimationFrame(() => {
      for (const l of this.listeners) l(theme);
    });
  }
}
