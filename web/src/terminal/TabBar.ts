// TabBar — horizontal tab strip with a `+` new-tab control + a `▾`
// dropdown for choosing same-session vs new-session, plus per-tab status
// dot, color dot, hover-close, double-click rename, drag-reorder, and
// right-click context menu.
//
// All inputs (tab list, active id, status per tab) come from the caller
// via setTabs / setActiveTabId; the bar fires events through callbacks
// it doesn't own state.
import type { SessionMode, SessionStatus, TabColor } from "./types.ts";
import { TAB_COLORS } from "./types.ts";

export type TabBarItem = {
  id: string;
  title: string;
  color: TabColor;
  status: SessionStatus;
  /** Permission mode of the bound session, or null if not paired yet. */
  mode: SessionMode | null;
  /**
   * Other tabs that share the same underlying session (only the *original*
   * sessionId). Used to draw the same-session underline. May include this
   * tab's own id.
   */
  sameSessionIds: string[];
};

export type TabBarCallbacks = {
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onRename: (tabId: string, newTitle: string) => void;
  onSetColor: (tabId: string, color: TabColor) => void;
  onReorder: (tabId: string, newIndex: number) => void;
  onContextMenu: (tabId: string, x: number, y: number) => void;
  onNewTab: (mode: "new-session" | "same-session") => void;
  /** True when a same-session option should be enabled. */
  canDuplicate: () => boolean;
};

export type TabBarController = {
  setTabs(tabs: TabBarItem[]): void;
  setActiveTabId(id: string | null): void;
  destroy(): void;
};

const CLOSE_ICON = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const PLUS_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
const CHEVRON_ICON = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`;
const EYE_ICON = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>`;

export function mountTabBar(
  host: HTMLElement,
  cb: TabBarCallbacks,
): TabBarController {
  host.innerHTML = `
    <div class="tabbar" role="tablist" aria-label="Open terminals">
      <div class="tabbar__strip" data-strip></div>
      <div class="tabbar__newgroup">
        <button class="tabbar__new" type="button" data-new-tab aria-label="New tab (new session)">${PLUS_ICON}</button>
        <button class="tabbar__new-caret" type="button" data-new-caret aria-label="More new-tab options">${CHEVRON_ICON}</button>
        <div class="tabbar__newmenu" data-newmenu hidden role="menu">
          <button
            class="tabbar__newmenu-item"
            role="menuitem"
            type="button"
            data-new-action="new-session"
          >
            <span class="tabbar__newmenu-line">
              <span class="tabbar__newmenu-icon">＋</span>
              New tab — new session
            </span>
            <span class="tabbar__newmenu-kbd">⌘T</span>
          </button>
          <button
            class="tabbar__newmenu-item"
            role="menuitem"
            type="button"
            data-new-action="same-session"
            data-same
          >
            <span class="tabbar__newmenu-line">
              <span class="tabbar__newmenu-icon">⊜</span>
              New tab — same session
            </span>
            <span class="tabbar__newmenu-kbd">⌘⇧T</span>
          </button>
        </div>
      </div>
    </div>
  `;

  const strip = host.querySelector<HTMLElement>("[data-strip]")!;
  const newBtn = host.querySelector<HTMLButtonElement>("[data-new-tab]")!;
  const caretBtn = host.querySelector<HTMLButtonElement>("[data-new-caret]")!;
  const newMenu = host.querySelector<HTMLElement>("[data-newmenu]")!;

  let tabs: TabBarItem[] = [];
  let activeId: string | null = null;
  let lastItemsHash = "";

  function hashItems(items: TabBarItem[]): string {
    return items
      .map(
        (i) =>
          `${i.id}|${i.title}|${i.color ?? ""}|${i.status}|${i.mode ?? ""}|${i.sameSessionIds.join(",")}`,
      )
      .join(";");
  }

  // Drag state
  let draggingId: string | null = null;
  let dragOverIndex: number | null = null;

  function openMenu(): void {
    const sameItem = newMenu.querySelector<HTMLButtonElement>("[data-same]")!;
    if (cb.canDuplicate()) {
      sameItem.removeAttribute("disabled");
      sameItem.removeAttribute("title");
    } else {
      sameItem.setAttribute("disabled", "");
      sameItem.title =
        "Splits and same-session tabs share one shell. Open a session first.";
    }
    newMenu.hidden = false;
    requestAnimationFrame(() => newMenu.classList.add("is-open"));
  }

  function closeMenu(): void {
    newMenu.classList.remove("is-open");
    setTimeout(() => {
      newMenu.hidden = true;
    }, 140);
  }

  newBtn.addEventListener("click", () => cb.onNewTab("new-session"));
  caretBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (newMenu.hidden) openMenu();
    else closeMenu();
  });

  newMenu.querySelectorAll<HTMLButtonElement>("[data-new-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset["newAction"] as "new-session" | "same-session";
      if (mode === "same-session" && !cb.canDuplicate()) return;
      closeMenu();
      cb.onNewTab(mode);
    });
  });

  const offClick = (ev: MouseEvent): void => {
    if (newMenu.hidden) return;
    if (newMenu.contains(ev.target as Node)) return;
    if (caretBtn.contains(ev.target as Node)) return;
    closeMenu();
  };
  document.addEventListener("click", offClick);

  function render(): void {
    strip.innerHTML = "";
    tabs.forEach((tab, idx) => {
      const isActive = tab.id === activeId;
      const isShared = tab.sameSessionIds.length > 1;
      const el = document.createElement("div");
      el.className = `tabbar__tab${isActive ? " is-active" : ""}${
        isShared ? " is-shared" : ""
      }${tab.id === draggingId ? " is-dragging" : ""}${
        dragOverIndex === idx ? " is-dragover" : ""
      }`;
      el.setAttribute("role", "tab");
      el.setAttribute("aria-selected", String(isActive));
      el.dataset["tabId"] = tab.id;
      el.draggable = true;

      const colorSwatch = tab.color
        ? `<span class="tabbar__tab-color" style="background:${TAB_COLORS[tab.color]}"></span>`
        : `<span class="tabbar__tab-color tabbar__tab-color--none"></span>`;

      const statusDot = `<span class="tabbar__tab-status tabbar__tab-status--${tab.status}" aria-hidden="true"></span>`;

      const sharedBadge = isShared
        ? `<span class="tabbar__tab-shared" title="Shares a session with ${
            tab.sameSessionIds.length - 1
          } other tab${tab.sameSessionIds.length - 1 === 1 ? "" : "s"}">⊜${tab.sameSessionIds.length}</span>`
        : "";

      const viewOnlyBadge =
        tab.mode === "view-only"
          ? `<span class="tabbar__tab-eye" title="View-only session — typing disabled">${EYE_ICON}</span>`
          : "";

      el.innerHTML = `
        ${colorSwatch}
        <span class="tabbar__tab-title" data-title>${escape(tab.title || "Terminal")}</span>
        ${viewOnlyBadge}
        ${sharedBadge}
        ${statusDot}
        <button class="tabbar__tab-close" type="button" data-close aria-label="Close tab">
          ${CLOSE_ICON}
        </button>
      `;

      el.addEventListener("click", (ev) => {
        const target = ev.target as HTMLElement;
        if (target.closest("[data-close]")) return;
        cb.onActivate(tab.id);
      });

      el.querySelector<HTMLButtonElement>("[data-close]")!.addEventListener(
        "click",
        (ev) => {
          ev.stopPropagation();
          cb.onClose(tab.id);
        },
      );

      const titleEl = el.querySelector<HTMLElement>("[data-title]")!;
      titleEl.addEventListener("dblclick", (ev) => {
        ev.stopPropagation();
        beginInlineRename(titleEl, tab);
      });

      el.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        cb.onContextMenu(tab.id, ev.clientX, ev.clientY);
      });

      // Drag-and-drop reorder
      el.addEventListener("dragstart", (ev) => {
        draggingId = tab.id;
        ev.dataTransfer?.setData("text/plain", tab.id);
        if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "move";
        el.classList.add("is-dragging");
      });
      el.addEventListener("dragend", () => {
        draggingId = null;
        dragOverIndex = null;
        render();
      });
      el.addEventListener("dragover", (ev) => {
        if (!draggingId) return;
        ev.preventDefault();
        if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
        if (dragOverIndex !== idx) {
          dragOverIndex = idx;
          render();
        }
      });
      el.addEventListener("drop", (ev) => {
        ev.preventDefault();
        if (!draggingId || draggingId === tab.id) return;
        cb.onReorder(draggingId, idx);
        draggingId = null;
        dragOverIndex = null;
      });

      strip.appendChild(el);
    });
  }

  function beginInlineRename(titleEl: HTMLElement, tab: TabBarItem): void {
    const current = tab.title;
    const input = document.createElement("input");
    input.className = "tabbar__tab-title-edit";
    input.type = "text";
    input.value = current;
    input.maxLength = 40;
    if (!titleEl.parentNode) {
      // Title element was detached (stale render); bail rather than create
      // an orphan input.
      return;
    }
    titleEl.replaceWith(input);
    input.focus();
    input.select();
    // Defensive: if anything steals focus on the next frame (e.g. xterm
    // refocus from a tab activation), grab it back.
    requestAnimationFrame(() => {
      if (document.activeElement !== input) {
        input.focus();
        input.select();
      }
    });

    const commit = (save: boolean): void => {
      const value = save ? input.value.trim() : current;
      const replacement = document.createElement("span");
      replacement.className = "tabbar__tab-title";
      replacement.dataset["title"] = "";
      replacement.textContent = value || "Terminal";
      input.replaceWith(replacement);
      replacement.addEventListener("dblclick", (ev) => {
        ev.stopPropagation();
        beginInlineRename(replacement, { ...tab, title: value });
      });
      if (save && value !== current) cb.onRename(tab.id, value);
    };

    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        commit(true);
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        commit(false);
      }
    });
    input.addEventListener("blur", () => commit(true));
  }

  return {
    setTabs: (next) => {
      // Skip the destructive re-render when nothing structurally changed.
      // Otherwise click handlers attached at render time get blown away
      // mid-interaction (e.g. between mousedown and dblclick for rename).
      const hash = hashItems(next);
      if (hash === lastItemsHash) {
        tabs = next;
        return;
      }
      lastItemsHash = hash;
      tabs = next;
      render();
    },
    setActiveTabId: (id) => {
      if (activeId === id) return;
      activeId = id;
      // Toggle the active class in place rather than rebuilding the DOM.
      for (const el of strip.querySelectorAll<HTMLElement>(".tabbar__tab")) {
        const tabId = el.dataset["tabId"];
        el.classList.toggle("is-active", tabId === id);
      }
    },
    destroy: () => {
      document.removeEventListener("click", offClick);
      host.innerHTML = "";
    },
  };
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
