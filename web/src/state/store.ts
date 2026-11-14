// Tiny observable store. Holds tabs + active tab + settings; persists a
// safe subset to localStorage on every mutation (per the brief's
// persistence rules: NEVER persist pairing codes, output buffers, or
// active connections).
//
// Vanilla TS — no library. Subscribers receive the latest snapshot.
import {
  DEFAULT_FONT_SETTINGS,
  DEFAULT_SEARCH_PREFS,
  DEFAULT_THEME,
  type FontFamily,
  type FontSettings,
  type PersistedState,
  type PersistedTab,
  type SearchPrefs,
  type TabColor,
  type ThemeName,
} from "../terminal/types.ts";

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type StoreOptions = {
  storage?: StorageAdapter;
  storageKey?: string;
  idFactory?: () => string;
};

export type StoreState = {
  tabs: PersistedTab[];
  activeTabId: string | null;
  settings: FontSettings & { theme: ThemeName };
  lastSettingsSection: string | null;
  searchPrefs: SearchPrefs;
};

type Listener = (state: StoreState) => void;

const DEFAULT_KEY = "peershell.state";
const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 24;
const LINE_HEIGHT_MIN = 1.0;
const LINE_HEIGHT_MAX = 1.6;

let counter = 0;
const defaultId = (): string => {
  counter += 1;
  return `tab-${Date.now().toString(36)}-${counter.toString(36)}`;
};

export type Store = {
  snapshot(): StoreState;
  subscribe(listener: Listener): () => void;

  addTab(opts: { title: string; originalSessionId: string; color?: TabColor }): string;
  removeTab(id: string): void;
  setActiveTab(id: string): void;
  renameTab(id: string, title: string): void;
  setTabColor(id: string, color: TabColor): void;
  reorderTab(id: string, newIndex: number): void;

  setTheme(name: ThemeName): void;
  setFontFamily(family: FontFamily): void;
  setFontSize(size: number): void;
  setLineHeight(lh: number): void;
  setLigatures(on: boolean): void;
  setLastSettingsSection(section: string | null): void;
  setSearchPrefs(prefs: SearchPrefs): void;
};

export function createStore(opts: StoreOptions = {}): Store {
  const storage: StorageAdapter | null = opts.storage ?? safeLocalStorage();
  const key = opts.storageKey ?? DEFAULT_KEY;
  const newId = opts.idFactory ?? defaultId;

  let state: StoreState = hydrate(storage, key);
  const listeners = new Set<Listener>();

  function emit(): void {
    persist(storage, key, state);
    for (const l of listeners) l(state);
  }

  function update(mutator: (s: StoreState) => StoreState): void {
    state = mutator(state);
    emit();
  }

  return {
    snapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    addTab: ({ title, originalSessionId, color = null }) => {
      const id = newId();
      const tab: PersistedTab = { id, title, color, originalSessionId };
      update((s) => ({ ...s, tabs: [...s.tabs, tab], activeTabId: id }));
      return id;
    },

    removeTab: (id) => {
      update((s) => {
        const idx = s.tabs.findIndex((t) => t.id === id);
        if (idx === -1) return s;
        const tabs = s.tabs.slice(0, idx).concat(s.tabs.slice(idx + 1));
        let activeTabId = s.activeTabId;
        if (s.activeTabId === id) {
          // Prefer the right neighbour; fall back to left; null if list emptied.
          activeTabId = tabs[idx]?.id ?? tabs[idx - 1]?.id ?? null;
        }
        return { ...s, tabs, activeTabId };
      });
    },

    setActiveTab: (id) => {
      update((s) =>
        s.tabs.some((t) => t.id === id) ? { ...s, activeTabId: id } : s,
      );
    },

    renameTab: (id, title) => {
      update((s) => ({
        ...s,
        tabs: s.tabs.map((t) => (t.id === id ? { ...t, title } : t)),
      }));
    },

    setTabColor: (id, color) => {
      update((s) => ({
        ...s,
        tabs: s.tabs.map((t) => (t.id === id ? { ...t, color } : t)),
      }));
    },

    reorderTab: (id, newIndex) => {
      update((s) => {
        const oldIndex = s.tabs.findIndex((t) => t.id === id);
        if (oldIndex === -1) return s;
        const clamped = Math.max(0, Math.min(s.tabs.length - 1, newIndex));
        const tabs = s.tabs.slice();
        const [moved] = tabs.splice(oldIndex, 1);
        tabs.splice(clamped, 0, moved!);
        return { ...s, tabs };
      });
    },

    setTheme: (name) => {
      update((s) => ({ ...s, settings: { ...s.settings, theme: name } }));
    },

    setFontFamily: (family) => {
      update((s) => ({ ...s, settings: { ...s.settings, family } }));
    },

    setFontSize: (size) => {
      const clamped = clamp(size, FONT_SIZE_MIN, FONT_SIZE_MAX);
      update((s) => ({ ...s, settings: { ...s.settings, size: clamped } }));
    },

    setLineHeight: (lh) => {
      const clamped = clamp(lh, LINE_HEIGHT_MIN, LINE_HEIGHT_MAX);
      update((s) => ({
        ...s,
        settings: { ...s.settings, lineHeight: clamped },
      }));
    },

    setLigatures: (on) => {
      update((s) => ({ ...s, settings: { ...s.settings, ligatures: on } }));
    },

    setLastSettingsSection: (section) => {
      update((s) => ({ ...s, lastSettingsSection: section }));
    },

    setSearchPrefs: (prefs) => {
      update((s) => ({ ...s, searchPrefs: { ...prefs } }));
    },
  };
}

// ── persistence ─────────────────────────────────────────────────────────

function hydrate(
  storage: StorageAdapter | null,
  key: string,
): StoreState {
  const fallback: StoreState = {
    tabs: [],
    activeTabId: null,
    settings: { ...DEFAULT_FONT_SETTINGS, theme: DEFAULT_THEME },
    lastSettingsSection: null,
    searchPrefs: { ...DEFAULT_SEARCH_PREFS },
  };
  if (!storage) return fallback;
  const raw = storage.getItem(key);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return {
      tabs: Array.isArray(parsed.tabs) ? parsed.tabs : fallback.tabs,
      activeTabId:
        typeof parsed.activeTabId === "string" ? parsed.activeTabId : null,
      settings: {
        ...fallback.settings,
        ...(parsed.settings ?? {}),
      },
      lastSettingsSection:
        typeof parsed.lastSettingsSection === "string"
          ? parsed.lastSettingsSection
          : null,
      searchPrefs: {
        ...fallback.searchPrefs,
        ...(parsed.searchPrefs ?? {}),
      },
    };
  } catch {
    return fallback;
  }
}

function persist(
  storage: StorageAdapter | null,
  key: string,
  state: StoreState,
): void {
  if (!storage) return;
  const payload: PersistedState = {
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    settings: state.settings,
    lastSettingsSection: state.lastSettingsSection,
    searchPrefs: state.searchPrefs,
  };
  try {
    storage.setItem(key, JSON.stringify(payload));
  } catch {
    // Quota exceeded or storage disabled — drop silently.
  }
}

function safeLocalStorage(): StorageAdapter | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const probe = "__peershell_probe__";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}
