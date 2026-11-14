// TerminalApp — top-level orchestrator for the /app surface.
//
// Owns:
//   • the Store (persisted tab list + settings)
//   • the SessionManager (live WebRTC sessions, refcounted)
//   • one runtime TabRuntime per persisted tab
//
// Each runtime, once live, hosts a PaneTree + PaneRenderer with one
// xterm pane per leaf. Splits go through the renderer; the renderer
// preserves leaf DOM elements across re-renders so xterm state survives.
import "../styles/themes/tokens.css";
import "../styles/themes/peershell-dark.css";
import "../styles/themes/peershell-light.css";
import "../styles/themes/solarized-dark.css";
import "../styles/themes/tokyo-night.css";
import "../styles/fonts.css";
import "../styles/terminal-chrome.css";
import "../styles/splits.css";
import "../styles/pairing.css";
import { createStore, type Store } from "../state/store.ts";
import { SessionManager } from "./SessionManager.ts";
import { TabSession, type TabSessionPhase } from "./TabSession.ts";
import { TerminalConnection } from "./TerminalConnection.ts";
import { mountPane, type TerminalPaneController } from "./TerminalPane.ts";
import { mountTabBar, type TabBarController, type TabBarItem } from "./TabBar.ts";
import { mountAppBar, type AppBarController } from "./AppBar.ts";
import {
  mountDiagnosticsPanel,
  type DiagnosticsPanelController,
} from "./DiagnosticsPanel.ts";
import { mountPairing, type PairingController } from "../pages/pairing.ts";
import { mountSessionEnded } from "../pages/session-ended.ts";
import { showTabContextMenu } from "./TabContextMenu.ts";
import { ThemeProvider } from "./ThemeProvider.ts";
import { mountSettingsDrawer, type SettingsDrawerController } from "./settings/SettingsDrawer.ts";
import { PaneTree } from "./PaneTree.ts";
import { mountPaneRenderer, type PaneRendererController } from "./PaneRenderer.ts";
import {
  mountSearchOverlay,
  type SearchOverlayController,
} from "./SearchOverlay.ts";
import "../styles/search-overlay.css";
import "../styles/command-palette.css";
import {
  mountCommandPalette,
  type CommandPaletteController,
} from "./CommandPalette.ts";
import { buildCommands } from "./commands.ts";
import type { Session } from "./Session.ts";
import type { FontSettings, SplitOrientation, TabColor, ThemeName } from "./types.ts";
import { FONT_SIZE_DEFAULT } from "./fonts.ts";

const THEME_CYCLE: ThemeName[] = [
  "peershell-dark",
  "peershell-light",
  "solarized-dark",
  "tokyo-night",
];

function serializeFont(s: FontSettings): string {
  return `${s.family}|${s.size}|${s.lineHeight}|${s.ligatures}`;
}

function attachmentIdFor(tabId: string, leafId: string): string {
  return `${tabId}:${leafId}`;
}

export type TerminalAppOptions = {
  signalingUrl: string;
  stunUrl: string;
};

export type TerminalAppController = {
  dispose(): void;
};

type SearchEntry = {
  overlay: SearchOverlayController;
  /** Last query — used to restore state if user reopens search on same leaf. */
  lastQuery: string;
  /** Live xterm result subscription. */
  unsubscribe: () => void;
};

type TabRuntime = {
  id: string;
  /** Per-tab content host inside the content area. Always mounted; hidden
   * when not active so xterm preserves scrollback. */
  host: HTMLElement;
  /** Live pairing controller while in the pairing phase, else null. */
  pairing: PairingController | null;
  /** Pane tree for this tab — null while in pairing/ended. */
  paneTree: PaneTree | null;
  /** Per-leaf xterm pane controllers — empty until live. */
  panes: Map<string, TerminalPaneController>;
  /** Active pane renderer for this tab, or null. */
  renderer: PaneRendererController | null;
  /** Per-leaf search overlay state. */
  searches: Map<string, SearchEntry>;
  /** Per-leaf last query (persists across overlay close/reopen). */
  lastSearchQuery: Map<string, string>;
  /** WebRTC orchestrator. */
  ts: TabSession;
  /** Bound session, after the channel opens. */
  sessionId: string | null;
};

export function mountTerminalApp(
  root: HTMLElement,
  opts: TerminalAppOptions,
): TerminalAppController {
  const store: Store = createStore({});
  const themes = new ThemeProvider(store);
  const sessionManager = new SessionManager();
  const connectionsBySession = new Map<string, TerminalConnection>();
  const runtimes = new Map<string, TabRuntime>();

  sessionManager.onBeforeDispose((session) => {
    const conn = connectionsBySession.get(session.id);
    if (conn) {
      conn.dispose();
      connectionsBySession.delete(session.id);
    }
  });

  const CWD_ICON = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;

  root.innerHTML = `
    <div class="termapp">
      <div class="termapp__appbar" data-appbar></div>
      <div class="termapp__tabbar" data-tabbar></div>
      <div class="termapp__content" data-content></div>
      <div class="termapp__footnote" data-footnote>
        <span class="termapp__cwd">
          <span class="termapp__cwd-icon">${CWD_ICON}</span>
          <span class="termapp__cwd-text" data-cwd></span>
        </span>
        <span class="termapp__timer" data-footer-timer></span>
        <span class="termapp__badge"><span class="termapp__badge-dot"></span>P2P · DTLS</span>
      </div>
    </div>
  `;

  const appBarHost = root.querySelector<HTMLElement>("[data-appbar]")!;
  const tabBarHost = root.querySelector<HTMLElement>("[data-tabbar]")!;
  const contentHost = root.querySelector<HTMLElement>("[data-content]")!;
  const cwdEl = root.querySelector<HTMLElement>("[data-cwd]")!;
  const footerTimerEl = root.querySelector<HTMLElement>("[data-footer-timer]")!;

  const appBar: AppBarController = mountAppBar(appBarHost);
  const drawer: SettingsDrawerController = mountSettingsDrawer(root, {
    themes,
    store,
    getActiveSession: () => {
      const r = activeRuntime();
      if (!r?.sessionId) return null;
      const s = sessionManager.get(r.sessionId);
      if (!s) return null;
      return {
        hostname: s.hostname,
        code: s.pairingCode,
        mode: s.mode,
      };
    },
  });
  const palette: CommandPaletteController = mountCommandPalette(root, {
    buildCommands: () => buildCommandList(),
  });
  appBar.onSettingsClick(() => drawer.toggle());
  appBar.onPaletteClick(() => palette.open());

  const diagnostics: DiagnosticsPanelController = mountDiagnosticsPanel(root, {
    anchorEl: appBar.getInfoButton(),
    getContext: () => {
      const r = activeRuntime();
      if (!r?.sessionId) return null;
      const sess = sessionManager.get(r.sessionId);
      const conn = connectionsBySession.get(r.sessionId);
      if (!sess || !conn) return null;
      return {
        pc: conn.getPeerConnection(),
        session: sess,
        startedAt: sessionStartedAt.get(r.sessionId) ?? Date.now(),
      };
    },
  });
  appBar.onInfoClick(() => diagnostics.toggle());
  const tabBar: TabBarController = mountTabBar(tabBarHost, {
    onActivate: (id) => activateTab(id),
    onClose: (id) => closeTab(id),
    onRename: (id, title) => store.renameTab(id, title || "Terminal"),
    onSetColor: (id, color) => store.setTabColor(id, color),
    onReorder: (id, idx) => store.reorderTab(id, idx),
    onContextMenu: (id, x, y) => openContextMenu(id, x, y),
    onNewTab: (mode) => {
      if (mode === "new-session") createNewTab();
      else duplicateActiveTab();
    },
    canDuplicate: () => {
      const active = activeRuntime();
      return !!active && active.sessionId !== null;
    },
  });

  // ── tab lifecycle ──────────────────────────────────────────────────────

  function createTab(opts: {
    title: string;
    originalSessionId: string;
    color?: TabColor;
  }): string {
    const id = store.addTab(opts);
    instantiateRuntime(id);
    activateTab(id);
    return id;
  }

  function createNewTab(): void {
    const placeholder = `os-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    createTab({ title: "New tab", originalSessionId: placeholder });
  }

  function duplicateActiveTab(): void {
    const active = activeRuntime();
    if (!active || !active.sessionId) return;
    const session = sessionManager.get(active.sessionId);
    if (!session) return;
    const originalSessionId =
      store.snapshot().tabs.find((t) => t.id === active.id)
        ?.originalSessionId ?? session.id;
    const id = store.addTab({
      title: nextSameSessionTitle(session.hostname ?? "Terminal"),
      originalSessionId,
    });
    instantiateRuntime(id);
    const runtime = runtimes.get(id)!;
    runtime.ts.attachSame(session);
    runtime.sessionId = session.id;
    mountLivePane(runtime, session);
    activateTab(id);
    refresh();
  }

  function nextSameSessionTitle(base: string): string {
    const existing = store
      .snapshot()
      .tabs.map((t) => t.title)
      .filter((t) => t.startsWith(base));
    if (existing.length === 0) return base;
    return `${base} ${existing.length + 1}`;
  }

  function instantiateRuntime(tabId: string): TabRuntime {
    const host = document.createElement("div");
    host.className = "termapp__tab-content";
    host.dataset["tabId"] = tabId;
    host.hidden = true;
    contentHost.appendChild(host);

    const ts = new TabSession({
      signalingUrl: opts.signalingUrl,
      stunUrl: opts.stunUrl,
      sessionManager,
      onPhase: (phase) => onPhase(tabId, phase),
    });

    const runtime: TabRuntime = {
      id: tabId,
      host,
      pairing: null,
      paneTree: null,
      panes: new Map(),
      renderer: null,
      searches: new Map(),
      lastSearchQuery: new Map(),
      ts,
      sessionId: null,
    };
    runtimes.set(tabId, runtime);
    mountPairingPhase(runtime);
    return runtime;
  }

  function closeSearchOnLeaf(runtime: TabRuntime, leafId: string): void {
    const entry = runtime.searches.get(leafId);
    if (!entry) return;
    runtime.lastSearchQuery.set(leafId, entry.overlay.query());
    entry.unsubscribe();
    entry.overlay.dispose();
    runtime.panes.get(leafId)?.clearSearch();
    runtime.searches.delete(leafId);
  }

  function disposeAllPanesOf(runtime: TabRuntime): void {
    for (const leafId of Array.from(runtime.searches.keys())) {
      closeSearchOnLeaf(runtime, leafId);
    }
    runtime.renderer?.dispose();
    runtime.renderer = null;
    runtime.paneTree = null;
    runtime.lastSearchQuery.clear();
    // Renderer.dispose calls onUnmount for each leaf which already disposes;
    // clear the map just in case any stragglers remain.
    runtime.panes.clear();
  }

  function mountPairingPhase(runtime: TabRuntime): void {
    runtime.host.innerHTML = "";
    disposeAllPanesOf(runtime);
    if (runtime.sessionId) {
      // No explicit detach needed — each pane's dispose detached itself.
      runtime.sessionId = null;
    }
    runtime.pairing = mountPairing(runtime.host, (code) => {
      void runtime.ts.startNew(code);
    });
  }

  function mountLivePane(runtime: TabRuntime, session: Session): void {
    runtime.pairing = null;
    runtime.host.innerHTML = "";
    const paneHost = document.createElement("div");
    paneHost.className = "termapp__pane paner-host";
    runtime.host.appendChild(paneHost);
    const connection = connectionsBySession.get(session.id);
    if (!connection) {
      console.warn("[terminal] no connection for session", session.id);
      return;
    }
    runtime.paneTree = new PaneTree({ sessionId: session.id });
    runtime.renderer = mountPaneRenderer(paneHost, {
      tree: runtime.paneTree,
      leaves: {
        onMount: (leafId, host) => {
          const pane = mountPane(host, {
            session,
            connection,
            attachmentId: attachmentIdFor(runtime.id, leafId),
            theme: themes.getXtermTheme(),
            font: store.snapshot().settings,
          });
          runtime.panes.set(leafId, pane);
          return { fit: () => pane.fit() };
        },
        onUnmount: (leafId) => {
          closeSearchOnLeaf(runtime, leafId);
          runtime.lastSearchQuery.delete(leafId);
          const pane = runtime.panes.get(leafId);
          pane?.dispose(); // also session.detach
          runtime.panes.delete(leafId);
        },
      },
      onSplit: (leafId, orientation: SplitOrientation) => {
        if (!runtime.paneTree || !runtime.renderer) return;
        runtime.paneTree.setFocus(leafId);
        const newLeafId = runtime.paneTree.splitFocused(orientation);
        runtime.renderer.render();
        // Hand focus to the freshly-created pane.
        session.setFocus(attachmentIdFor(runtime.id, newLeafId));
        runtime.panes.get(newLeafId)?.focus();
      },
      onClose: (leafId) => {
        if (!runtime.paneTree || !runtime.renderer) return;
        if (runtime.paneTree.leaves().length <= 1) return; // no-op per brief
        runtime.paneTree.setFocus(leafId);
        runtime.paneTree.closeFocused();
        runtime.renderer.render();
        const focused = runtime.paneTree.focusedLeafId;
        session.setFocus(attachmentIdFor(runtime.id, focused));
        runtime.panes.get(focused)?.focus();
      },
      onSetRatio: (splitId, ratio) => {
        runtime.paneTree?.setRatio(splitId, ratio);
        runtime.renderer?.render();
      },
      onSetFocus: (leafId) => {
        // Non-destructive: just update the focused-leaf class so we don't
        // wipe the DOM between mousedown (on a button) and click.
        runtime.paneTree?.setFocus(leafId);
        session.setFocus(attachmentIdFor(runtime.id, leafId));
        runtime.renderer?.setFocusVisual(leafId);
      },
      onOpenSearch: (leafId) => {
        openSearchOnLeaf(runtime, leafId);
      },
    });
  }

  function openSearchOnLeaf(runtime: TabRuntime, leafId: string): void {
    if (!runtime.renderer || !runtime.paneTree) return;
    // Already open → just focus it.
    const existing = runtime.searches.get(leafId);
    if (existing) {
      existing.overlay.focusInput();
      return;
    }
    const leafHost = runtime.renderer.getLeafHost(leafId);
    const pane = runtime.panes.get(leafId);
    if (!leafHost || !pane) return;

    const lastQuery = runtime.lastSearchQuery.get(leafId) ?? "";
    const prefs = store.snapshot().searchPrefs;

    const overlay = mountSearchOverlay(leafHost, {
      initialQuery: lastQuery,
      initialPrefs: prefs,
      onSearchChange: (query, p) => {
        if (!query) {
          pane.clearSearch();
          overlay.setResults(null);
          return;
        }
        pane.findNext(query, p);
      },
      onNext: (query, p) => {
        if (!query) return;
        pane.findNext(query, p);
      },
      onPrevious: (query, p) => {
        if (!query) return;
        pane.findPrevious(query, p);
      },
      onClose: () => {
        closeSearchOnLeaf(runtime, leafId);
        runtime.panes.get(leafId)?.focus();
      },
      onPrefsChange: (p) => store.setSearchPrefs(p),
    });
    const unsub = pane.onSearchResults((info) => overlay.setResults(info));
    runtime.searches.set(leafId, {
      overlay,
      lastQuery,
      unsubscribe: unsub,
    });
    overlay.focusInput();
    // If there's a prior query, kick off the search to restore matches.
    if (lastQuery) {
      pane.findNext(lastQuery, prefs);
    }
  }

  function mountEndedPhase(
    runtime: TabRuntime,
    reason: "user" | "remote" | "failed",
    extraMessage?: string,
  ): void {
    runtime.host.innerHTML = "";
    runtime.pairing = null;
    disposeAllPanesOf(runtime);
    if (runtime.sessionId) {
      sessionManager.disposeNow(runtime.sessionId);
      runtime.sessionId = null;
    }
    mountSessionEnded(runtime.host, {
      reason,
      onReconnect: () => {
        mountPairingPhase(runtime);
        refresh();
      },
    });
    if (extraMessage) {
      const note = document.createElement("p");
      note.className = "termapp__end-note";
      note.textContent = extraMessage;
      runtime.host.appendChild(note);
    }
  }

  function onPhase(tabId: string, phase: TabSessionPhase): void {
    const runtime = runtimes.get(tabId);
    if (!runtime) return;
    switch (phase.kind) {
      case "idle":
        return;
      case "pairing":
        runtime.pairing?.setState({ kind: "connecting" });
        return;
      case "preview":
        runtime.pairing?.setState({
          kind: "preview",
          mode: phase.mode,
          hostname: phase.hostname,
          onConfirm: () => {
            void runtime.ts.commit();
          },
          onCancel: () => {
            runtime.ts.dispose();
            mountPairingPhase(runtime);
            refresh();
          },
        });
        return;
      case "connecting":
        return;
      case "live": {
        if (phase.connection && !connectionsBySession.has(phase.session.id)) {
          connectionsBySession.set(phase.session.id, phase.connection);
        }
        runtime.sessionId = phase.session.id;
        sessionStartedAt.set(phase.session.id, Date.now());
        mountLivePane(runtime, phase.session);
        const tab = store.snapshot().tabs.find((t) => t.id === tabId);
        if (tab && tab.title === "New tab") {
          store.renameTab(tabId, phase.session.hostname ?? "Terminal");
        }
        rebindFooterToActive();
        refresh();
        return;
      }
      case "ended":
        mountEndedPhase(runtime, phase.reason);
        refresh();
        return;
      case "error":
        runtime.pairing?.setState({ kind: "error", message: phase.message });
        return;
    }
  }

  /**
   * Tracks which tab's content is currently visible in the DOM. Distinct
   * from `store.activeTabId` — the store can be set before any DOM has
   * been mounted (e.g. boot, fresh tab creation), so we mustn't use it
   * to decide "already displayed".
   */
  let displayedTabId: string | null = null;

  function activateTab(id: string): void {
    if (!runtimes.has(id)) return;
    // True no-op only when the tab is already showing on screen — this
    // is the case that needs to skip refocus (dblclick → inline rename).
    if (displayedTabId === id) return;
    displayedTabId = id;
    store.setActiveTab(id);
    for (const r of runtimes.values()) {
      r.host.hidden = r.id !== id;
    }
    const active = runtimes.get(id);
    if (active?.paneTree && active.renderer) {
      const focusedLeafId = active.paneTree.focusedLeafId;
      active.panes.get(focusedLeafId)?.fit();
      requestAnimationFrame(() => {
        // Don't steal focus if the user is editing something (rename input,
        // search bar input, etc).
        const ae = document.activeElement;
        if (
          ae instanceof HTMLInputElement ||
          ae instanceof HTMLTextAreaElement
        ) {
          return;
        }
        active.panes.get(focusedLeafId)?.focus();
      });
    }
    rebindFooterToActive();
    refresh();
  }

  function closeTab(id: string): void {
    const runtime = runtimes.get(id);
    if (!runtime) return;
    disposeAllPanesOf(runtime);
    if (runtime.sessionId) {
      sessionManager.disposeNow(runtime.sessionId);
    }
    runtime.ts.dispose();
    runtime.host.remove();
    runtimes.delete(id);
    if (displayedTabId === id) displayedTabId = null;
    store.removeTab(id);
    refresh();
    const nextActive = store.snapshot().activeTabId;
    if (nextActive) activateTab(nextActive);
  }

  function openContextMenu(tabId: string, x: number, y: number): void {
    const tabs = store.snapshot().tabs;
    const idx = tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return;
    const runtime = runtimes.get(tabId);
    showTabContextMenu({
      x,
      y,
      canDuplicate: !!runtime?.sessionId,
      canMoveLeft: idx > 0,
      canMoveRight: idx < tabs.length - 1,
      canCloseOthers: tabs.length > 1,
      canCloseRight: idx < tabs.length - 1,
      onAction: (action) => {
        switch (action.kind) {
          case "rename":
            beginRename(tabId);
            return;
          case "set-color":
            store.setTabColor(tabId, action.color);
            return;
          case "duplicate":
            if (runtime?.sessionId) {
              const session = sessionManager.get(runtime.sessionId);
              if (session) {
                store.setActiveTab(tabId);
                duplicateActiveTab();
              }
            }
            return;
          case "move-left":
            store.reorderTab(tabId, idx - 1);
            return;
          case "move-right":
            store.reorderTab(tabId, idx + 1);
            return;
          case "close":
            closeTab(tabId);
            return;
          case "close-others":
            for (const t of tabs) if (t.id !== tabId) closeTab(t.id);
            return;
          case "close-right":
            for (let i = tabs.length - 1; i > idx; i--) {
              closeTab(tabs[i]!.id);
            }
            return;
        }
      },
    });
  }

  function beginRename(tabId: string): void {
    activateTab(tabId);
    const tabEl = tabBarHost.querySelector<HTMLElement>(
      `[data-tab-id="${tabId}"] [data-title]`,
    );
    tabEl?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  }

  function activeRuntime(): TabRuntime | null {
    const id = store.snapshot().activeTabId;
    return id ? runtimes.get(id) ?? null : null;
  }

  // ── render glue ────────────────────────────────────────────────────────

  // ── footer state (cwd + duration) ──────────────────────────────────────

  /** Maps Session.id → when that session was first observed live. */
  const sessionStartedAt = new Map<string, number>();
  /** Active session's cwd unsubscribe handle (re-bound on activate). */
  let activeCwdUnsub: (() => void) | null = null;

  function renderCwd(cwd: string | null): void {
    if (cwd) {
      cwdEl.textContent = cwd;
      cwdEl.removeAttribute("data-empty");
      cwdEl.removeAttribute("title");
    } else {
      cwdEl.textContent = "shell hasn't reported a path";
      cwdEl.setAttribute("data-empty", "");
      cwdEl.setAttribute(
        "title",
        "Most shells set the window title to the cwd automatically. If yours doesn't, add: \nPROMPT_COMMAND='printf \"\\033]7;file://%s%s\\033\\\\\" \"$HOSTNAME\" \"$PWD\"'",
      );
    }
  }

  function rebindFooterToActive(): void {
    activeCwdUnsub?.();
    activeCwdUnsub = null;
    const runtime = activeRuntime();
    const session = runtime?.sessionId
      ? sessionManager.get(runtime.sessionId)
      : null;
    if (!session) {
      cwdEl.textContent = "";
      cwdEl.removeAttribute("data-empty");
      cwdEl.removeAttribute("title");
      return;
    }
    if (!sessionStartedAt.has(session.id)) {
      sessionStartedAt.set(session.id, Date.now());
    }
    renderCwd(session.cwd);
    activeCwdUnsub = session.onCwdChange((cwd) => renderCwd(cwd));
    updateFooterTimer();
  }

  function updateFooterTimer(): void {
    const runtime = activeRuntime();
    const session = runtime?.sessionId
      ? sessionManager.get(runtime.sessionId)
      : null;
    if (!session) {
      footerTimerEl.textContent = "";
      return;
    }
    const startedAt = sessionStartedAt.get(session.id) ?? Date.now();
    footerTimerEl.textContent = formatElapsed(Date.now() - startedAt);
  }

  const footerTimerHandle = window.setInterval(updateFooterTimer, 1000);

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

  function refresh(): void {
    const state = store.snapshot();
    const groupBy = new Map<string, string[]>();
    for (const tab of state.tabs) {
      const arr = groupBy.get(tab.originalSessionId) ?? [];
      arr.push(tab.id);
      groupBy.set(tab.originalSessionId, arr);
    }

    const items: TabBarItem[] = state.tabs.map((tab) => {
      const runtime = runtimes.get(tab.id);
      const sessionId = runtime?.sessionId;
      const session = sessionId ? sessionManager.get(sessionId) : null;
      const status = session?.status ?? (sessionId ? "disconnected" : "pairing");
      return {
        id: tab.id,
        title: tab.title,
        color: tab.color,
        status,
        mode: session?.mode ?? null,
        sameSessionIds: groupBy.get(tab.originalSessionId) ?? [tab.id],
      };
    });
    tabBar.setTabs(items);
    tabBar.setActiveTabId(state.activeTabId);

    const active = activeRuntime();
    if (active?.sessionId) {
      const session = sessionManager.get(active.sessionId);
      appBar.setStatus(
        session?.status ?? "disconnected",
        session?.hostname ? `Connected · ${session.hostname}` : "Connected",
      );
      appBar.setMode(session?.mode ?? null);
    } else {
      appBar.setStatus("pairing", null);
      appBar.setMode(null);
    }
  }

  // Apply font settings to every live pane in every tab.
  function applyFontToAllPanes(fontSettings: FontSettings): void {
    for (const runtime of runtimes.values()) {
      for (const pane of runtime.panes.values()) {
        pane.setFont(fontSettings);
      }
    }
  }

  // Apply theme to every live pane in every tab.
  function applyThemeToAllPanes(): void {
    const xt = themes.getXtermTheme();
    for (const runtime of runtimes.values()) {
      for (const pane of runtime.panes.values()) {
        pane.setTheme(xt);
        pane.fit();
      }
    }
  }

  let lastFontSerialized = serializeFont(store.snapshot().settings);
  const unsubStore = store.subscribe((state) => {
    refresh();
    reorderHostsToMatchStore();
    const nextFont = serializeFont(state.settings);
    if (nextFont !== lastFontSerialized) {
      lastFontSerialized = nextFont;
      applyFontToAllPanes(state.settings);
    }
  });

  const unsubThemes = themes.onChange(() => {
    applyThemeToAllPanes();
  });

  // ── global keyboard shortcuts ──────────────────────────────────────────

  function focusedSplitContext():
    | { runtime: TabRuntime; session: Session; focusedLeafId: string }
    | null {
    const runtime = activeRuntime();
    if (!runtime || !runtime.paneTree || !runtime.sessionId) return null;
    const session = sessionManager.get(runtime.sessionId);
    if (!session) return null;
    return {
      runtime,
      session,
      focusedLeafId: runtime.paneTree.focusedLeafId,
    };
  }

  function splitFocusedPane(orientation: SplitOrientation): void {
    const ctx = focusedSplitContext();
    if (!ctx) return;
    const { runtime, session } = ctx;
    const newLeafId = runtime.paneTree!.splitFocused(orientation);
    runtime.renderer!.render();
    session.setFocus(attachmentIdFor(runtime.id, newLeafId));
    runtime.panes.get(newLeafId)?.focus();
  }

  function closeFocusedPaneOrTab(): void {
    const ctx = focusedSplitContext();
    if (!ctx) return;
    const { runtime, session } = ctx;
    if (runtime.paneTree!.leaves().length > 1) {
      runtime.paneTree!.closeFocused();
      runtime.renderer!.render();
      const focused = runtime.paneTree!.focusedLeafId;
      session.setFocus(attachmentIdFor(runtime.id, focused));
      runtime.panes.get(focused)?.focus();
    } else {
      closeTab(runtime.id);
    }
  }

  function focusAdjacent(direction: "left" | "right" | "up" | "down"): void {
    const ctx = focusedSplitContext();
    if (!ctx) return;
    if (ctx.runtime.paneTree!.focusAdjacent(direction)) {
      ctx.runtime.renderer!.render();
      const focused = ctx.runtime.paneTree!.focusedLeafId;
      ctx.session.setFocus(attachmentIdFor(ctx.runtime.id, focused));
      ctx.runtime.panes.get(focused)?.focus();
    }
  }

  function openSearchOnFocused(): void {
    const ctx = focusedSplitContext();
    if (!ctx) return;
    openSearchOnLeaf(ctx.runtime, ctx.focusedLeafId);
  }

  function findNextOnFocused(): void {
    const ctx = focusedSplitContext();
    if (!ctx) return;
    const entry = ctx.runtime.searches.get(ctx.focusedLeafId);
    if (entry) {
      entry.overlay.next();
    } else {
      // Open the overlay (with the last query if any) then jump.
      openSearchOnLeaf(ctx.runtime, ctx.focusedLeafId);
    }
  }

  function findPreviousOnFocused(): void {
    const ctx = focusedSplitContext();
    if (!ctx) return;
    const entry = ctx.runtime.searches.get(ctx.focusedLeafId);
    if (entry) {
      entry.overlay.previous();
    } else {
      openSearchOnLeaf(ctx.runtime, ctx.focusedLeafId);
    }
  }

  function reconnectActiveSession(): void {
    const runtime = activeRuntime();
    if (!runtime) return;
    mountPairingPhase(runtime);
    refresh();
  }

  function disconnectActiveSession(): void {
    const runtime = activeRuntime();
    if (!runtime) return;
    mountEndedPhase(runtime, "user");
    refresh();
  }

  async function copyToClipboard(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Silent — clipboard may be blocked by browser permission state.
    }
  }

  function copyPairingCode(): void {
    const runtime = activeRuntime();
    if (!runtime?.sessionId) return;
    const s = sessionManager.get(runtime.sessionId);
    if (!s) return;
    void copyToClipboard(formatCode(s.pairingCode));
  }

  function copySessionInfo(): void {
    const runtime = activeRuntime();
    if (!runtime?.sessionId) return;
    const s = sessionManager.get(runtime.sessionId);
    if (!s) return;
    const lines = [
      `Peershell session`,
      `Code: ${formatCode(s.pairingCode)}`,
      s.hostname ? `Host: ${s.hostname}` : null,
      `Status: ${s.status}`,
    ].filter(Boolean) as string[];
    void copyToClipboard(lines.join("\n"));
  }

  function toggleTheme(): void {
    const idx = THEME_CYCLE.indexOf(themes.current());
    const next = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]!;
    themes.set(next);
  }

  function renameActiveTab(): void {
    const runtime = activeRuntime();
    if (!runtime) return;
    beginRename(runtime.id);
  }

  function setActiveTabColor(color: TabColor): void {
    const runtime = activeRuntime();
    if (!runtime) return;
    store.setTabColor(runtime.id, color);
  }

  function formatCode(code: string): string {
    if (code.length !== 6) return code;
    return `${code.slice(0, 3)}-${code.slice(3)}`;
  }

  function buildCommandList() {
    const runtime = activeRuntime();
    const sess = runtime?.sessionId
      ? sessionManager.get(runtime.sessionId)
      : null;
    const tabsState = store.snapshot().tabs;
    return buildCommands({
      activeTabId: runtime?.id ?? null,
      activeTabTitle:
        tabsState.find((t) => t.id === runtime?.id)?.title ?? null,
      activeSession: sess
        ? {
            id: sess.id,
            code: sess.pairingCode,
            hostname: sess.hostname,
          }
        : null,
      paneCount: runtime?.paneTree?.leaves().length ?? 0,
      tabs: tabsState.map((t) => ({ id: t.id, title: t.title })),
      currentTheme: themes.current(),
      currentFontSize: store.snapshot().settings.size,
      actions: {
        newTabNewSession: () => createNewTab(),
        newTabSameSession: () => duplicateActiveTab(),
        closeActiveTab: () => {
          if (runtime) closeTab(runtime.id);
        },
        renameActiveTab,
        setActiveTabColor,
        duplicateActiveTab,
        splitVertical: () => splitFocusedPane("vertical"),
        splitHorizontal: () => splitFocusedPane("horizontal"),
        closeFocusedPane: () => closeFocusedPaneOrTab(),
        focusNextPane: () => focusAdjacent("right"),
        openSearch: openSearchOnFocused,
        findNext: findNextOnFocused,
        findPrevious: findPreviousOnFocused,
        switchToTab: (tabId) => activateTab(tabId),
        reconnectActiveSession,
        disconnectActiveSession,
        setTheme: (name) => themes.set(name),
        toggleTheme,
        increaseFontSize: () =>
          store.setFontSize(store.snapshot().settings.size + 1),
        decreaseFontSize: () =>
          store.setFontSize(store.snapshot().settings.size - 1),
        resetFontSize: () => store.setFontSize(FONT_SIZE_DEFAULT),
        openSettings: () => drawer.open(),
        openKeyboardReference: () => drawer.open("keyboard"),
        copyPairingCode,
        copySessionInfo,
      },
    });
  }

  function onWindowKey(ev: KeyboardEvent): void {
    const mod = ev.metaKey || ev.ctrlKey;
    if (!mod) return;

    // Font size — no alt modifier.
    if (!ev.altKey && !ev.shiftKey) {
      if (ev.key === "=" || ev.key === "+") {
        ev.preventDefault();
        store.setFontSize(store.snapshot().settings.size + 1);
        return;
      }
      if (ev.key === "-" || ev.key === "_") {
        ev.preventDefault();
        store.setFontSize(store.snapshot().settings.size - 1);
        return;
      }
      if (ev.key === "0") {
        ev.preventDefault();
        store.setFontSize(FONT_SIZE_DEFAULT);
        return;
      }
    }

    // Splits.
    if (!ev.altKey) {
      // Cmd/Ctrl+D → split vertical; Cmd/Ctrl+Shift+D → split horizontal
      if (ev.key === "d" || ev.key === "D") {
        ev.preventDefault();
        splitFocusedPane(ev.shiftKey ? "horizontal" : "vertical");
        return;
      }
      // Cmd/Ctrl+W → close pane (or tab if only pane)
      if (!ev.shiftKey && (ev.key === "w" || ev.key === "W")) {
        ev.preventDefault();
        closeFocusedPaneOrTab();
        return;
      }
    }

    // Search.
    if (!ev.altKey) {
      // Cmd/Ctrl+F → open search on focused pane
      if (!ev.shiftKey && (ev.key === "f" || ev.key === "F")) {
        ev.preventDefault();
        openSearchOnFocused();
        return;
      }
      // Cmd/Ctrl+G → next match; Cmd/Ctrl+Shift+G → previous
      if (ev.key === "g" || ev.key === "G") {
        ev.preventDefault();
        if (ev.shiftKey) findPreviousOnFocused();
        else findNextOnFocused();
        return;
      }
    }

    // Command palette + settings.
    if (!ev.altKey && !ev.shiftKey) {
      if (ev.key === "k" || ev.key === "K") {
        ev.preventDefault();
        palette.toggle();
        return;
      }
      if (ev.key === ",") {
        ev.preventDefault();
        drawer.toggle();
        return;
      }
    }

    // Tab management.
    if (!ev.altKey) {
      // Cmd/Ctrl + 1..9 — switch to tab N
      if (!ev.shiftKey && /^[1-9]$/.test(ev.key)) {
        const idx = Number(ev.key) - 1;
        const tab = store.snapshot().tabs[idx];
        if (tab) {
          ev.preventDefault();
          activateTab(tab.id);
        }
        return;
      }
      // Cmd/Ctrl + Shift + W → close entire tab (vs Cmd+W which is pane-aware)
      if (ev.shiftKey && (ev.key === "w" || ev.key === "W")) {
        ev.preventDefault();
        const r = activeRuntime();
        if (r) closeTab(r.id);
        return;
      }
      // Cmd/Ctrl + Tab / Shift+Tab → cycle tabs
      if (ev.key === "Tab") {
        const tabs = store.snapshot().tabs;
        const activeId = store.snapshot().activeTabId;
        if (tabs.length > 1 && activeId) {
          const idx = tabs.findIndex((t) => t.id === activeId);
          if (idx !== -1) {
            const delta = ev.shiftKey ? -1 : 1;
            const next = tabs[(idx + delta + tabs.length) % tabs.length]!;
            ev.preventDefault();
            activateTab(next.id);
          }
        }
        return;
      }
    }

    // Move current tab left/right — Ctrl+Alt+Arrow (avoid macOS Cmd+Alt
    // global shortcuts; brief specifies Ctrl+Alt for this one).
    if (ev.ctrlKey && ev.altKey) {
      const activeId = store.snapshot().activeTabId;
      if (!activeId) return;
      const tabs = store.snapshot().tabs;
      const idx = tabs.findIndex((t) => t.id === activeId);
      if (idx === -1) return;
      if (ev.key === "ArrowRight" && idx < tabs.length - 1) {
        ev.preventDefault();
        store.reorderTab(activeId, idx + 1);
        return;
      }
      if (ev.key === "ArrowLeft" && idx > 0) {
        ev.preventDefault();
        store.reorderTab(activeId, idx - 1);
        return;
      }
    }

    // Focus adjacent pane — Cmd/Ctrl+Alt+Arrow
    if (ev.altKey) {
      if (ev.key === "ArrowLeft") {
        ev.preventDefault();
        focusAdjacent("left");
        return;
      }
      if (ev.key === "ArrowRight") {
        ev.preventDefault();
        focusAdjacent("right");
        return;
      }
      if (ev.key === "ArrowUp") {
        ev.preventDefault();
        focusAdjacent("up");
        return;
      }
      if (ev.key === "ArrowDown") {
        ev.preventDefault();
        focusAdjacent("down");
        return;
      }
    }
  }
  window.addEventListener("keydown", onWindowKey);

  function reorderHostsToMatchStore(): void {
    const order = store.snapshot().tabs.map((t) => t.id);
    for (const id of order) {
      const r = runtimes.get(id);
      if (r) contentHost.appendChild(r.host);
    }
  }

  // ── boot ───────────────────────────────────────────────────────────────

  const persisted = store.snapshot().tabs;
  if (persisted.length === 0) {
    createNewTab();
  } else {
    for (const tab of persisted) {
      instantiateRuntime(tab.id);
    }
    const activeId =
      store.snapshot().activeTabId ?? persisted[0]?.id ?? null;
    if (activeId) activateTab(activeId);
  }
  refresh();

  return {
    dispose: () => {
      window.removeEventListener("keydown", onWindowKey);
      window.clearInterval(footerTimerHandle);
      activeCwdUnsub?.();
      unsubStore();
      unsubThemes();
      palette.dispose();
      drawer.dispose();
      diagnostics.dispose();
      themes.dispose();
      for (const runtime of runtimes.values()) {
        disposeAllPanesOf(runtime);
        runtime.ts.dispose();
        if (runtime.sessionId) sessionManager.disposeNow(runtime.sessionId);
      }
      runtimes.clear();
      tabBar.destroy();
      root.innerHTML = "";
    },
  };
}
