// Recursive pane tree owned by a single tab. Every leaf binds to one
// session (always the tab's session in v1 — splits don't introduce new
// sessions). Operations:
//   - splitFocused(orientation) → splits the focused leaf into two; the
//     newly-created leaf becomes the focused one
//   - closeFocused() → removes the focused leaf and collapses the sibling
//     into the parent slot; returns false when this would empty the tree
//   - setFocus(id) → moves focus to the given leaf id
//
// IDs are random strings, scoped to the tree (never persisted — splits
// rebuild fresh per the brief's persistence rules).
import type { PaneNode, SplitOrientation } from "./types.ts";

export type PaneTreeOptions = {
  sessionId: string;
  /** Override the id generator for deterministic tests. */
  idFactory?: () => string;
};

let counter = 0;
const defaultId = (): string => {
  counter += 1;
  return `pane-${Date.now().toString(36)}-${counter.toString(36)}`;
};

export type LeafInfo = {
  id: string;
  sessionId: string;
};

export class PaneTree {
  private readonly sessionId: string;
  private readonly newId: () => string;
  root: PaneNode;
  focusedLeafId: string;

  constructor(opts: PaneTreeOptions) {
    this.sessionId = opts.sessionId;
    this.newId = opts.idFactory ?? defaultId;
    const rootId = this.newId();
    this.root = { kind: "leaf", id: rootId, sessionId: this.sessionId };
    this.focusedLeafId = rootId;
  }

  leaves(): LeafInfo[] {
    const out: LeafInfo[] = [];
    walk(this.root, (node) => {
      if (node.kind === "leaf")
        out.push({ id: node.id, sessionId: node.sessionId });
    });
    return out;
  }

  splitFocused(orientation: SplitOrientation): string {
    const newLeafId = this.newId();
    const newLeaf: PaneNode = {
      kind: "leaf",
      id: newLeafId,
      sessionId: this.sessionId,
    };
    this.root = transform(this.root, (node) => {
      if (node.kind === "leaf" && node.id === this.focusedLeafId) {
        return {
          kind: "split",
          id: this.newId(),
          orientation,
          ratio: 0.5,
          children: [node, newLeaf],
        };
      }
      return null;
    });
    this.focusedLeafId = newLeafId;
    return newLeafId;
  }

  closeFocused(): boolean {
    if (this.root.kind === "leaf") return false;
    const focused = this.focusedLeafId;
    const result = removeLeaf(this.root, focused);
    if (!result) return false;
    this.root = result.tree;
    this.focusedLeafId = result.nextFocusId;
    return true;
  }

  setFocus(leafId: string): void {
    const exists = this.leaves().some((l) => l.id === leafId);
    if (!exists) {
      throw new Error(`PaneTree: leaf ${leafId} not found`);
    }
    this.focusedLeafId = leafId;
  }

  /**
   * Adjust the size ratio of a split node. Clamps to [0.05, 0.95] so
   * neither side collapses to invisibility from the splitter alone (use
   * closeFocused for actual removal).
   */
  setRatio(splitId: string, ratio: number): void {
    const clamped = Math.max(0.05, Math.min(0.95, ratio));
    this.root = transform(this.root, (node) => {
      if (node.kind === "split" && node.id === splitId) {
        return { ...node, ratio: clamped };
      }
      return null;
    });
  }

  /**
   * Move focus to the physically-adjacent leaf in the given direction.
   * Returns true if focus moved, false if no neighbour exists.
   *
   * Direction conventions:
   *   left/right  → traverse the nearest vertical (side-by-side) split
   *   up/down     → traverse the nearest horizontal (stacked) split
   */
  focusAdjacent(direction: "left" | "right" | "up" | "down"): boolean {
    const path = pathToLeaf(this.root, this.focusedLeafId);
    if (!path) return false;
    const orientation: SplitOrientation =
      direction === "left" || direction === "right" ? "vertical" : "horizontal";
    const wantOtherSideIndex = direction === "right" || direction === "down" ? 1 : 0;
    // Walk up: find the first split that matches orientation where we
    // came from the OPPOSITE side of the direction we want to move.
    for (let i = path.length - 1; i >= 0; i--) {
      const step = path[i]!;
      if (step.node.kind !== "split") continue;
      if (step.node.orientation !== orientation) continue;
      const cameFrom = step.childIndex;
      const targetIndex = wantOtherSideIndex;
      if (cameFrom === targetIndex) continue; // wrong side; keep walking
      // Descend into the target child to its edge-most leaf.
      const targetSubtree = step.node.children[targetIndex]!;
      const targetLeaf = edgeLeafId(targetSubtree, direction);
      this.focusedLeafId = targetLeaf;
      return true;
    }
    return false;
  }
}

// ── helpers ──────────────────────────────────────────────────────────────

function walk(node: PaneNode, visit: (n: PaneNode) => void): void {
  visit(node);
  if (node.kind === "split") {
    walk(node.children[0], visit);
    walk(node.children[1], visit);
  }
}

/**
 * Run `op` on every node in postorder; if it returns a new node, replace.
 * Used to swap a focused leaf with a freshly-built split.
 */
function transform(
  node: PaneNode,
  op: (n: PaneNode) => PaneNode | null,
): PaneNode {
  if (node.kind === "leaf") {
    return op(node) ?? node;
  }
  const left = transform(node.children[0], op);
  const right = transform(node.children[1], op);
  const updated: PaneNode = {
    ...node,
    children: [left, right],
  };
  return op(updated) ?? updated;
}

/**
 * Returns the rewritten tree (with the leaf removed and its sibling
 * collapsed into its grandparent slot), plus the id of the leaf that
 * should receive focus next. Returns null when the leaf wasn't found
 * inside any split (e.g. tree is a single leaf).
 */
function removeLeaf(
  node: PaneNode,
  leafId: string,
): { tree: PaneNode; nextFocusId: string } | null {
  if (node.kind === "leaf") return null;

  const [a, b] = node.children;
  const aIsTarget = a.kind === "leaf" && a.id === leafId;
  const bIsTarget = b.kind === "leaf" && b.id === leafId;

  if (aIsTarget) {
    // Sibling `b` replaces this split entirely.
    return {
      tree: b,
      nextFocusId: firstLeafId(b),
    };
  }
  if (bIsTarget) {
    return {
      tree: a,
      nextFocusId: firstLeafId(a),
    };
  }

  // Recurse into either side.
  const leftResult = removeLeaf(a, leafId);
  if (leftResult) {
    return {
      tree: { ...node, children: [leftResult.tree, b] },
      nextFocusId: leftResult.nextFocusId,
    };
  }
  const rightResult = removeLeaf(b, leafId);
  if (rightResult) {
    return {
      tree: { ...node, children: [a, rightResult.tree] },
      nextFocusId: rightResult.nextFocusId,
    };
  }
  return null;
}

function firstLeafId(node: PaneNode): string {
  if (node.kind === "leaf") return node.id;
  return firstLeafId(node.children[0]);
}

/**
 * Walk from root to the leaf with the given id, returning each node + the
 * child-index taken at every split. Returns null if the leaf isn't found.
 */
function pathToLeaf(
  root: PaneNode,
  leafId: string,
): Array<{ node: PaneNode; childIndex: number }> | null {
  const path: Array<{ node: PaneNode; childIndex: number }> = [];
  function visit(node: PaneNode): boolean {
    if (node.kind === "leaf") {
      return node.id === leafId;
    }
    for (let i = 0; i < 2; i++) {
      path.push({ node, childIndex: i });
      if (visit(node.children[i]!)) return true;
      path.pop();
    }
    return false;
  }
  if (!visit(root)) return null;
  return path;
}

/**
 * Walk from a subtree to the edge-most leaf in a given direction.
 * Going right → leftmost leaf of the subtree (the one nearest the splitter
 * the user just crossed). And so on for the other three directions.
 */
function edgeLeafId(
  node: PaneNode,
  direction: "left" | "right" | "up" | "down",
): string {
  if (node.kind === "leaf") return node.id;
  // Picking which child to descend into:
  //   when moving right, we entered the right subtree from its left edge,
  //   so we want its leftmost leaf — index 0 of vertical splits, either
  //   child of horizontal splits (top is the natural target).
  // The simplest rule that matches user expectation: descend index 0 for
  //   right/down (favour top-left); index 1 for left/up (favour bottom-right).
  const idx = direction === "right" || direction === "down" ? 0 : 1;
  return edgeLeafId(node.children[idx]!, direction);
}
