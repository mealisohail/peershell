// Right-click context menu for a tab. Mounted on demand at the click
// coordinates; dismisses on outside-click, Esc, or after an action is
// chosen.
import type { TabColor } from "./types.ts";
import { TAB_COLORS } from "./types.ts";

export type ContextAction =
  | { kind: "rename" }
  | { kind: "set-color"; color: TabColor }
  | { kind: "duplicate" }
  | { kind: "move-left" }
  | { kind: "move-right" }
  | { kind: "close" }
  | { kind: "close-others" }
  | { kind: "close-right" };

export type TabContextMenuOptions = {
  x: number;
  y: number;
  canDuplicate: boolean;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  canCloseOthers: boolean;
  canCloseRight: boolean;
  onAction: (action: ContextAction) => void;
};

let openMenu: HTMLElement | null = null;

export function showTabContextMenu(opts: TabContextMenuOptions): void {
  dismiss();

  const menu = document.createElement("div");
  menu.className = "tab-ctx";
  menu.setAttribute("role", "menu");

  const swatches = (Object.keys(TAB_COLORS) as Array<NonNullable<TabColor>>)
    .map(
      (c) =>
        `<button class="tab-ctx__swatch" type="button" data-color="${c}" style="background:${TAB_COLORS[c]}" aria-label="Color: ${c}"></button>`,
    )
    .join("");

  menu.innerHTML = `
    <button class="tab-ctx__item" type="button" data-action="rename">Rename tab</button>
    <div class="tab-ctx__color-row" role="group" aria-label="Tab color">
      <span class="tab-ctx__color-label">Color</span>
      <div class="tab-ctx__swatches">
        ${swatches}
        <button class="tab-ctx__swatch tab-ctx__swatch--none" type="button" data-color="" aria-label="No color">×</button>
      </div>
    </div>
    <div class="tab-ctx__sep"></div>
    <button class="tab-ctx__item" type="button" data-action="duplicate"${opts.canDuplicate ? "" : " disabled"}>
      Duplicate tab <span class="tab-ctx__hint">(same session)</span>
    </button>
    <button class="tab-ctx__item" type="button" data-action="move-left"${opts.canMoveLeft ? "" : " disabled"}>Move left</button>
    <button class="tab-ctx__item" type="button" data-action="move-right"${opts.canMoveRight ? "" : " disabled"}>Move right</button>
    <div class="tab-ctx__sep"></div>
    <button class="tab-ctx__item" type="button" data-action="close">Close tab</button>
    <button class="tab-ctx__item" type="button" data-action="close-others"${opts.canCloseOthers ? "" : " disabled"}>Close other tabs</button>
    <button class="tab-ctx__item" type="button" data-action="close-right"${opts.canCloseRight ? "" : " disabled"}>Close tabs to the right</button>
  `;

  document.body.appendChild(menu);
  openMenu = menu;

  // Position with viewport-edge guard.
  const rect = menu.getBoundingClientRect();
  const margin = 8;
  const px = Math.min(opts.x, window.innerWidth - rect.width - margin);
  const py = Math.min(opts.y, window.innerHeight - rect.height - margin);
  menu.style.left = `${Math.max(margin, px)}px`;
  menu.style.top = `${Math.max(margin, py)}px`;

  menu.querySelectorAll<HTMLElement>("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.hasAttribute("disabled")) return;
      const action = btn.dataset["action"];
      dismiss();
      if (action === "rename") opts.onAction({ kind: "rename" });
      else if (action === "duplicate") opts.onAction({ kind: "duplicate" });
      else if (action === "move-left") opts.onAction({ kind: "move-left" });
      else if (action === "move-right") opts.onAction({ kind: "move-right" });
      else if (action === "close") opts.onAction({ kind: "close" });
      else if (action === "close-others")
        opts.onAction({ kind: "close-others" });
      else if (action === "close-right") opts.onAction({ kind: "close-right" });
    });
  });

  menu.querySelectorAll<HTMLElement>("[data-color]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = btn.dataset["color"] ?? "";
      const color: TabColor =
        value === ""
          ? null
          : (value as NonNullable<TabColor>);
      dismiss();
      opts.onAction({ kind: "set-color", color });
    });
  });

  const offClick = (ev: MouseEvent): void => {
    if (!openMenu) return;
    if (openMenu.contains(ev.target as Node)) return;
    dismiss();
  };
  const offKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape") {
      dismiss();
    }
  };
  // Defer registration so the click that opened us doesn't immediately dismiss.
  setTimeout(() => {
    document.addEventListener("click", offClick);
    document.addEventListener("keydown", offKey);
  }, 0);

  (menu as HTMLElement & { __cleanup?: () => void }).__cleanup = () => {
    document.removeEventListener("click", offClick);
    document.removeEventListener("keydown", offKey);
  };
}

function dismiss(): void {
  if (!openMenu) return;
  const cleanup = (openMenu as HTMLElement & { __cleanup?: () => void }).__cleanup;
  cleanup?.();
  openMenu.remove();
  openMenu = null;
}
