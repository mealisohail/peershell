// SearchOverlay — slide-down search bar attached to one pane. Owns its
// own input + toggle state; reports back via callbacks. Persists toggle
// preferences globally via the Store; per-pane query state is runtime.
import "../styles/search-overlay.css";
import type { SearchPrefs } from "./types.ts";

export type SearchOverlayCallbacks = {
  /** Fires on every input change (incremental search). */
  onSearchChange: (query: string, prefs: SearchPrefs) => void;
  /** Fires on Enter or ↓ button or Cmd/Ctrl+G */
  onNext: (query: string, prefs: SearchPrefs) => void;
  /** Fires on Shift+Enter or ↑ button or Cmd/Ctrl+Shift+G */
  onPrevious: (query: string, prefs: SearchPrefs) => void;
  /** Fires on Esc or × close button. */
  onClose: () => void;
  /** Fires when the user toggles a search option — persist globally. */
  onPrefsChange: (prefs: SearchPrefs) => void;
};

export type SearchOverlayOptions = SearchOverlayCallbacks & {
  initialQuery: string;
  initialPrefs: SearchPrefs;
};

export type SearchOverlayController = {
  /** Update the displayed match counter. Pass null/undefined to hide it. */
  setResults(info: { resultIndex: number; resultCount: number } | null): void;
  /** Focus and select the input — used when re-opening with a prior query. */
  focusInput(): void;
  /** Read the current query string. */
  query(): string;
  /** Read the current toggle state. */
  prefs(): SearchPrefs;
  /** Dispatch a "find next" — useful for Cmd+G when overlay is already open. */
  next(): void;
  /** Dispatch a "find previous". */
  previous(): void;
  /** Clean up DOM + event listeners. */
  dispose(): void;
};

const CLOSE_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const ARROW_UP_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`;
const ARROW_DOWN_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>`;

export function mountSearchOverlay(
  host: HTMLElement,
  opts: SearchOverlayOptions,
): SearchOverlayController {
  const overlay = document.createElement("div");
  overlay.className = "search-overlay";
  overlay.innerHTML = `
    <input
      class="search-overlay__input"
      type="text"
      data-input
      placeholder="Search"
      autocomplete="off"
      spellcheck="false"
      value="${escape(opts.initialQuery)}"
    />
    <span class="search-overlay__count" data-count></span>
    <div class="search-overlay__group" role="group" aria-label="Search options">
      <button
        class="search-overlay__toggle"
        type="button"
        data-toggle="caseSensitive"
        title="Case sensitive"
        aria-pressed="${opts.initialPrefs.caseSensitive}"
        ${opts.initialPrefs.caseSensitive ? "data-active" : ""}
      >Aa</button>
      <button
        class="search-overlay__toggle"
        type="button"
        data-toggle="wholeWord"
        title="Whole word"
        aria-pressed="${opts.initialPrefs.wholeWord}"
        ${opts.initialPrefs.wholeWord ? "data-active" : ""}
      >W</button>
      <button
        class="search-overlay__toggle"
        type="button"
        data-toggle="regex"
        title="Regular expression"
        aria-pressed="${opts.initialPrefs.regex}"
        ${opts.initialPrefs.regex ? "data-active" : ""}
      >.*</button>
    </div>
    <div class="search-overlay__nav" role="group" aria-label="Navigate matches">
      <button class="search-overlay__nav-btn" type="button" data-prev aria-label="Previous match (Shift+Enter)">${ARROW_UP_ICON}</button>
      <button class="search-overlay__nav-btn" type="button" data-next aria-label="Next match (Enter)">${ARROW_DOWN_ICON}</button>
    </div>
    <button class="search-overlay__close" type="button" data-close aria-label="Close search (Esc)">${CLOSE_ICON}</button>
  `;
  host.appendChild(overlay);

  const input = overlay.querySelector<HTMLInputElement>("[data-input]")!;
  const countEl = overlay.querySelector<HTMLElement>("[data-count]")!;
  const prevBtn = overlay.querySelector<HTMLButtonElement>("[data-prev]")!;
  const nextBtn = overlay.querySelector<HTMLButtonElement>("[data-next]")!;
  const closeBtn = overlay.querySelector<HTMLButtonElement>("[data-close]")!;
  const toggleBtns = overlay.querySelectorAll<HTMLButtonElement>(
    "[data-toggle]",
  );

  let prefs: SearchPrefs = { ...opts.initialPrefs };

  function setResults(
    info: { resultIndex: number; resultCount: number } | null,
  ): void {
    if (!info || info.resultCount === 0) {
      countEl.textContent = input.value ? "No matches" : "";
      overlay.classList.toggle("is-empty", input.value.length > 0);
      return;
    }
    countEl.textContent = `${info.resultIndex + 1} / ${info.resultCount}`;
    overlay.classList.remove("is-empty");
  }

  input.addEventListener("input", () => {
    opts.onSearchChange(input.value, prefs);
  });
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      if (ev.shiftKey) opts.onPrevious(input.value, prefs);
      else opts.onNext(input.value, prefs);
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      opts.onClose();
    }
  });

  prevBtn.addEventListener("click", () => opts.onPrevious(input.value, prefs));
  nextBtn.addEventListener("click", () => opts.onNext(input.value, prefs));
  closeBtn.addEventListener("click", () => opts.onClose());

  toggleBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset["toggle"] as keyof SearchPrefs;
      prefs = { ...prefs, [key]: !prefs[key] };
      const active = prefs[key];
      btn.toggleAttribute("data-active", active);
      btn.setAttribute("aria-pressed", String(active));
      opts.onPrefsChange(prefs);
      opts.onSearchChange(input.value, prefs);
    });
  });

  return {
    setResults,
    focusInput: () => {
      input.focus();
      input.select();
    },
    query: () => input.value,
    prefs: () => prefs,
    next: () => opts.onNext(input.value, prefs),
    previous: () => opts.onPrevious(input.value, prefs),
    dispose: () => {
      overlay.remove();
    },
  };
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
