// CommandPalette — Cmd/Ctrl+K modal overlay. Fuzzy-filterable list of
// commands. Arrows navigate, Enter executes, Esc closes.
//
// The palette owns its DOM and event listeners; it's opened on demand by
// TerminalApp, which provides a fresh command list each time.
import "../styles/command-palette.css";
import { fuzzyMatch, type Command, type CommandCategory } from "./commands.ts";

export type CommandPaletteOptions = {
  /** Re-evaluated each open so we reflect current app state. */
  buildCommands: () => Command[];
};

export type CommandPaletteController = {
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  dispose(): void;
};

const CATEGORY_ORDER: CommandCategory[] = [
  "Tabs",
  "Splits",
  "Search",
  "Sessions",
  "Appearance",
  "General",
];

export function mountCommandPalette(
  root: HTMLElement,
  opts: CommandPaletteOptions,
): CommandPaletteController {
  const wrap = document.createElement("div");
  wrap.className = "cmdp";
  wrap.hidden = true;
  wrap.innerHTML = `
    <div class="cmdp__backdrop" data-backdrop></div>
    <div class="cmdp__shell" role="dialog" aria-label="Command palette" aria-modal="true">
      <input
        class="cmdp__input"
        type="text"
        data-input
        placeholder="Search or run a command…"
        autocomplete="off"
        spellcheck="false"
      />
      <div class="cmdp__list" data-list role="listbox"></div>
      <div class="cmdp__footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
        <span><kbd>Enter</kbd> select</span>
        <span><kbd>Esc</kbd> close</span>
      </div>
    </div>
  `;
  root.appendChild(wrap);

  const backdrop = wrap.querySelector<HTMLElement>("[data-backdrop]")!;
  const input = wrap.querySelector<HTMLInputElement>("[data-input]")!;
  const list = wrap.querySelector<HTMLElement>("[data-list]")!;

  let isOpen = false;
  let commands: Command[] = [];
  type RankedCommand = { cmd: Command; score: number };
  let filtered: RankedCommand[] = [];
  let activeIndex = 0;

  function setActiveIndex(i: number): void {
    const max = filtered.length - 1;
    if (max < 0) {
      activeIndex = 0;
      return;
    }
    activeIndex = ((i % filtered.length) + filtered.length) % filtered.length;
    list
      .querySelectorAll<HTMLElement>(".cmdp__item")
      .forEach((el, idx) => el.classList.toggle("is-active", idx === activeIndex));
    const activeEl = list.querySelector<HTMLElement>(".cmdp__item.is-active");
    activeEl?.scrollIntoView({ block: "nearest" });
  }

  function refilter(): void {
    const q = input.value.trim();
    const ranked: RankedCommand[] = [];
    for (const cmd of commands) {
      const score = fuzzyMatch(cmd.label, q);
      if (score === null) continue;
      ranked.push({ cmd, score });
    }
    // Sort by score ascending; with no query, keep insertion order.
    if (q) {
      ranked.sort((a, b) => a.score - b.score);
    }
    filtered = ranked;
    renderList();
    setActiveIndex(0);
  }

  function renderList(): void {
    if (filtered.length === 0) {
      list.innerHTML = `<div class="cmdp__empty">No commands match.</div>`;
      return;
    }
    const q = input.value.trim();
    if (q) {
      // Flat list when filtered — no category headers.
      list.innerHTML = filtered.map((r, i) => renderItem(r.cmd, i)).join("");
    } else {
      // Grouped list when empty query — categories in fixed order.
      const byCat = new Map<CommandCategory, Command[]>();
      for (const r of filtered) {
        const arr = byCat.get(r.cmd.category) ?? [];
        arr.push(r.cmd);
        byCat.set(r.cmd.category, arr);
      }
      let html = "";
      let flatIdx = 0;
      for (const cat of CATEGORY_ORDER) {
        const items = byCat.get(cat);
        if (!items || items.length === 0) continue;
        html += `<div class="cmdp__section">${cat}</div>`;
        for (const cmd of items) {
          html += renderItem(cmd, flatIdx++);
        }
      }
      list.innerHTML = html;
    }
    // Wire click handlers.
    list.querySelectorAll<HTMLElement>(".cmdp__item").forEach((el, i) => {
      el.addEventListener("click", () => {
        setActiveIndex(i);
        execute();
      });
      el.addEventListener("mousemove", () => setActiveIndex(i));
    });
  }

  function renderItem(cmd: Command, idx: number): string {
    const enabled = cmd.enabled !== false;
    const cls = `cmdp__item${enabled ? "" : " is-disabled"}${
      idx === activeIndex ? " is-active" : ""
    }`;
    const swatch = isHex(cmd.hint)
      ? `<span class="cmdp__swatch" style="background:${cmd.hint}"></span>`
      : "";
    const hint =
      cmd.hint && !isHex(cmd.hint)
        ? `<span class="cmdp__item-hint">${escape(cmd.hint)}</span>`
        : "";
    const kbd = cmd.kbd ? `<span class="cmdp__kbd">${escape(cmd.kbd)}</span>` : "";
    return `
      <div class="${cls}" role="option" data-cmd-idx="${idx}" aria-disabled="${!enabled}">
        ${swatch}
        <span class="cmdp__item-label">${escape(cmd.label)}</span>
        ${hint}
        ${kbd}
      </div>
    `;
  }

  function execute(): void {
    const ranked = filtered[activeIndex];
    if (!ranked) return;
    if (ranked.cmd.enabled === false) return;
    close();
    // Defer so the close-paint happens before the command runs (e.g. focus).
    setTimeout(() => ranked.cmd.action(), 0);
  }

  function open(): void {
    if (isOpen) return;
    isOpen = true;
    commands = opts.buildCommands();
    input.value = "";
    refilter();
    wrap.hidden = false;
    requestAnimationFrame(() => {
      wrap.classList.add("is-open");
      input.focus();
    });
  }

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    wrap.classList.remove("is-open");
    setTimeout(() => {
      wrap.hidden = true;
    }, 160);
  }

  input.addEventListener("input", () => refilter());
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      setActiveIndex(activeIndex + 1);
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      setActiveIndex(activeIndex - 1);
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      execute();
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      close();
    }
  });
  backdrop.addEventListener("click", close);

  return {
    open,
    close,
    toggle: () => (isOpen ? close() : open()),
    isOpen: () => isOpen,
    dispose: () => wrap.remove(),
  };
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isHex(s: string | undefined): boolean {
  return !!s && /^#[0-9a-fA-F]{3,8}$/.test(s);
}
