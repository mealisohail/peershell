// PaneRenderer — recursive renderer that materialises a PaneTree into the
// DOM. Each leaf has a stable wrapper element preserved across re-renders
// so its xterm instance survives splits and resizes. Splitter bars are
// 1px draggable hairlines between sibling panes.
import type { PaneTree } from "./PaneTree.ts";
import type { PaneNode, SplitOrientation } from "./types.ts";

export type LeafMount = {
  /** Called once per new leaf — return the controller so the renderer can
   * trigger a fit() pass after splitter drags. */
  onMount: (leafId: string, host: HTMLElement) => { fit: () => void };
  onUnmount: (leafId: string) => void;
};

export type PaneRendererOptions = {
  tree: PaneTree;
  leaves: LeafMount;
  onSplit: (leafId: string, orientation: SplitOrientation) => void;
  onClose: (leafId: string) => void;
  onSetRatio: (splitId: string, ratio: number) => void;
  onSetFocus: (leafId: string) => void;
  /** Called when the user requests "open search in this pane" — phase G
   * fills this in; for now it's a stub. */
  onOpenSearch?: (leafId: string) => void;
};

export type PaneRendererController = {
  /** Re-render the DOM tree (call after tree mutations). */
  render(): void;
  /**
   * Update the focused-leaf class without rebuilding the DOM tree.
   * MUST be used for focus changes — full render() between mousedown and
   * click on the action group buttons detaches the button and the click
   * never fires.
   */
  setFocusVisual(leafId: string): void;
  /** Return the wrapper element for a leaf so callers (e.g. SearchOverlay)
   * can mount additional UI on top of the pane. */
  getLeafHost(leafId: string): HTMLElement | null;
  /** Tear down all live panes. */
  dispose(): void;
};

const MIN_PANE_WIDTH = 200;
const MIN_PANE_HEIGHT = 80;

const ICON_SPLIT_V = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="7.5" height="16" rx="1.5"/><rect x="13.5" y="4" width="7.5" height="16" rx="1.5"/></svg>`;
const ICON_SPLIT_H = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="7.5" rx="1.5"/><rect x="4" y="13.5" width="16" height="7.5" rx="1.5"/></svg>`;
const ICON_CLOSE = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const ICON_SEARCH = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`;

export function mountPaneRenderer(
  host: HTMLElement,
  opts: PaneRendererOptions,
): PaneRendererController {
  host.classList.add("paner-root");

  /** Wrapper element per leaf id, preserved across re-renders. */
  const leafWraps = new Map<string, HTMLElement>();
  /** Per-leaf "fit" callback so we can refit on splitter drag. */
  const leafFits = new Map<string, () => void>();

  function createLeafWrap(leafId: string): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "paner-leaf";
    wrap.dataset["leafId"] = leafId;

    const termHost = document.createElement("div");
    termHost.className = "paner-leaf__term";
    wrap.appendChild(termHost);

    const actions = document.createElement("div");
    actions.className = "paner-leaf__actions";
    actions.setAttribute("aria-label", "Pane actions");
    actions.innerHTML = `
      <button class="paner-leaf__act" type="button" data-act="split-v" title="Split vertically (Cmd/Ctrl+D)">${ICON_SPLIT_V}</button>
      <button class="paner-leaf__act" type="button" data-act="split-h" title="Split horizontally (Cmd/Ctrl+Shift+D)">${ICON_SPLIT_H}</button>
      <button class="paner-leaf__act" type="button" data-act="search" title="Search this pane (Cmd/Ctrl+F)">${ICON_SEARCH}</button>
      <button class="paner-leaf__act" type="button" data-act="close" title="Close pane (Cmd/Ctrl+W)">${ICON_CLOSE}</button>
    `;
    wrap.appendChild(actions);

    actions.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const act = btn.dataset["act"];
        if (act === "split-v") opts.onSplit(leafId, "vertical");
        else if (act === "split-h") opts.onSplit(leafId, "horizontal");
        else if (act === "close") opts.onClose(leafId);
        else if (act === "search") opts.onOpenSearch?.(leafId);
      });
    });

    // Clicking anywhere in the pane wrap focuses it.
    wrap.addEventListener("mousedown", () => opts.onSetFocus(leafId));

    // Hand the term host to the consumer to mount xterm into.
    const ctl = opts.leaves.onMount(leafId, termHost);
    leafFits.set(leafId, ctl.fit);
    return wrap;
  }

  function renderNode(node: PaneNode): HTMLElement {
    if (node.kind === "leaf") {
      const existing = leafWraps.get(node.id);
      if (existing) return existing;
      const wrap = createLeafWrap(node.id);
      leafWraps.set(node.id, wrap);
      return wrap;
    }
    const splitEl = document.createElement("div");
    splitEl.className = `paner-split paner-split--${node.orientation}`;
    splitEl.dataset["splitId"] = node.id;

    const a = renderNode(node.children[0]);
    const b = renderNode(node.children[1]);
    const splitter = makeSplitter(splitEl, node.id, node.orientation);

    // Apply sizing.
    if (node.orientation === "vertical") {
      a.style.width = `${node.ratio * 100}%`;
      a.style.height = "100%";
      b.style.flex = "1";
      b.style.height = "100%";
    } else {
      a.style.height = `${node.ratio * 100}%`;
      a.style.width = "100%";
      b.style.flex = "1";
      b.style.width = "100%";
    }

    splitEl.appendChild(a);
    splitEl.appendChild(splitter);
    splitEl.appendChild(b);
    return splitEl;
  }

  function makeSplitter(
    container: HTMLElement,
    splitId: string,
    orientation: SplitOrientation,
  ): HTMLElement {
    const bar = document.createElement("div");
    bar.className = `paner-splitter paner-splitter--${orientation}`;
    bar.setAttribute("role", "separator");
    bar.tabIndex = -1;

    let dragging = false;

    bar.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      dragging = true;
      document.body.style.cursor =
        orientation === "vertical" ? "col-resize" : "row-resize";
      const onMove = (mv: MouseEvent): void => {
        if (!dragging) return;
        const rect = container.getBoundingClientRect();
        const min =
          orientation === "vertical"
            ? MIN_PANE_WIDTH / rect.width
            : MIN_PANE_HEIGHT / rect.height;
        const max = 1 - min;
        let ratio: number;
        if (orientation === "vertical") {
          ratio = (mv.clientX - rect.left) / rect.width;
        } else {
          ratio = (mv.clientY - rect.top) / rect.height;
        }
        ratio = Math.max(min, Math.min(max, ratio));
        opts.onSetRatio(splitId, ratio);
        // Refit every pane after the split changes geometry.
        for (const fit of leafFits.values()) fit();
      };
      const onUp = (): void => {
        dragging = false;
        document.body.style.cursor = "";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });

    // Double-click → reset to 50/50.
    bar.addEventListener("dblclick", () => {
      opts.onSetRatio(splitId, 0.5);
      for (const fit of leafFits.values()) fit();
    });

    return bar;
  }

  function render(): void {
    // Detect removed leaves and dispose them before rebuilding the tree.
    const liveLeafIds = new Set<string>();
    walkLeafIds(opts.tree.root, liveLeafIds);
    for (const [leafId] of leafWraps) {
      if (!liveLeafIds.has(leafId)) {
        opts.leaves.onUnmount(leafId);
        leafFits.delete(leafId);
        leafWraps.delete(leafId);
      }
    }

    // Mark the focused leaf so CSS can paint the accent ring on it.
    host.dataset["focusedLeaf"] = opts.tree.focusedLeafId;

    // Rebuild DOM; existing leaf wrappers are reparented in place (not
    // remounted), so the xterm instances inside them keep their state.
    host.innerHTML = "";
    host.appendChild(renderNode(opts.tree.root));

    // Apply is-focused class to the focused leaf wrap.
    for (const [id, wrap] of leafWraps) {
      wrap.classList.toggle("is-focused", id === opts.tree.focusedLeafId);
    }

    // Refit all panes once the new geometry settles.
    requestAnimationFrame(() => {
      for (const fit of leafFits.values()) fit();
    });
  }

  // Initial render
  render();

  return {
    render,
    setFocusVisual: (leafId) => {
      host.dataset["focusedLeaf"] = leafId;
      for (const [id, wrap] of leafWraps) {
        wrap.classList.toggle("is-focused", id === leafId);
      }
    },
    getLeafHost: (leafId) => leafWraps.get(leafId) ?? null,
    dispose: () => {
      for (const [leafId] of leafWraps) {
        opts.leaves.onUnmount(leafId);
      }
      leafFits.clear();
      leafWraps.clear();
      host.innerHTML = "";
      host.classList.remove("paner-root");
    },
  };
}

function walkLeafIds(node: PaneNode, out: Set<string>): void {
  if (node.kind === "leaf") {
    out.add(node.id);
    return;
  }
  walkLeafIds(node.children[0], out);
  walkLeafIds(node.children[1], out);
}
