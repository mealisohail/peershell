import { test } from "node:test";
import assert from "node:assert/strict";
import { PaneTree } from "./PaneTree.ts";

test("new tree has a single leaf bound to the session, that leaf is focused", () => {
  const t = new PaneTree({ sessionId: "s1" });
  const leaves = t.leaves();
  assert.equal(leaves.length, 1);
  assert.equal(leaves[0]!.sessionId, "s1");
  assert.equal(t.focusedLeafId, leaves[0]!.id);
});

test("splitFocused vertical produces two leaves; new leaf becomes focused", () => {
  const t = new PaneTree({ sessionId: "s1" });
  const before = t.focusedLeafId;
  const newId = t.splitFocused("vertical");
  const leaves = t.leaves();
  assert.equal(leaves.length, 2);
  assert.notEqual(newId, before);
  assert.equal(t.focusedLeafId, newId);
  // Both leaves share the session.
  for (const l of leaves) assert.equal(l.sessionId, "s1");
});

test("splitFocused horizontal records orientation correctly", () => {
  const t = new PaneTree({ sessionId: "s1" });
  t.splitFocused("horizontal");
  const root = t.root;
  assert.equal(root.kind, "split");
  if (root.kind !== "split") return;
  assert.equal(root.orientation, "horizontal");
});

test("nested splits work: split → focus the new pane → split again", () => {
  const t = new PaneTree({ sessionId: "s1" });
  t.splitFocused("vertical");
  t.splitFocused("horizontal");
  assert.equal(t.leaves().length, 3);
});

test("closeFocused removes the focused leaf and collapses its sibling up", () => {
  const t = new PaneTree({ sessionId: "s1" });
  const newId = t.splitFocused("vertical");
  const originalLeaf = t.leaves().find((l) => l.id !== newId)!;
  assert.equal(t.closeFocused(), true);
  const after = t.leaves();
  assert.equal(after.length, 1);
  assert.equal(after[0]!.id, originalLeaf.id);
  assert.equal(t.focusedLeafId, originalLeaf.id);
});

test("closeFocused on the last leaf returns false (no-op)", () => {
  const t = new PaneTree({ sessionId: "s1" });
  assert.equal(t.closeFocused(), false);
  assert.equal(t.leaves().length, 1);
});

test("setFocus(id) changes the focused leaf", () => {
  const t = new PaneTree({ sessionId: "s1" });
  const newId = t.splitFocused("vertical");
  const otherId = t.leaves().find((l) => l.id !== newId)!.id;
  t.setFocus(otherId);
  assert.equal(t.focusedLeafId, otherId);
});

test("setFocus on a non-existent id throws", () => {
  const t = new PaneTree({ sessionId: "s1" });
  assert.throws(() => t.setFocus("ghost"));
});

test("leafIds returns ids in left-to-right depth-first order", () => {
  const t = new PaneTree({ sessionId: "s1" });
  const a = t.focusedLeafId;
  const b = t.splitFocused("vertical");
  t.setFocus(a);
  const c = t.splitFocused("horizontal");
  // Tree: split(v) [ split(h) [a, c], b ]
  const ids = t.leaves().map((l) => l.id);
  assert.deepEqual(ids, [a, c, b]);
});

test("setRatio updates the matching split node", () => {
  const t = new PaneTree({ sessionId: "s1" });
  t.splitFocused("vertical");
  const splitId = (t.root as { id: string }).id;
  t.setRatio(splitId, 0.3);
  assert.equal((t.root as { ratio: number }).ratio, 0.3);
});

test("setRatio clamps to [0.05, 0.95] to keep both sides visible", () => {
  const t = new PaneTree({ sessionId: "s1" });
  t.splitFocused("vertical");
  const splitId = (t.root as { id: string }).id;
  t.setRatio(splitId, 1.5);
  assert.equal((t.root as { ratio: number }).ratio, 0.95);
  t.setRatio(splitId, -0.5);
  assert.equal((t.root as { ratio: number }).ratio, 0.05);
});

test("setRatio is a no-op for unknown split id", () => {
  const t = new PaneTree({ sessionId: "s1" });
  t.splitFocused("vertical");
  const before = (t.root as { ratio: number }).ratio;
  t.setRatio("ghost", 0.7);
  assert.equal((t.root as { ratio: number }).ratio, before);
});

test("focusAdjacent('right') from left pane of a vertical split", () => {
  const t = new PaneTree({ sessionId: "s1" });
  const a = t.focusedLeafId;
  const b = t.splitFocused("vertical");
  t.setFocus(a);
  assert.equal(t.focusAdjacent("right"), true);
  assert.equal(t.focusedLeafId, b);
});

test("focusAdjacent('left') from right pane returns to left pane", () => {
  const t = new PaneTree({ sessionId: "s1" });
  const a = t.focusedLeafId;
  t.splitFocused("vertical"); // b is focused now
  assert.equal(t.focusAdjacent("left"), true);
  assert.equal(t.focusedLeafId, a);
});

test("focusAdjacent('down') from top pane of a horizontal split", () => {
  const t = new PaneTree({ sessionId: "s1" });
  const a = t.focusedLeafId;
  const b = t.splitFocused("horizontal");
  t.setFocus(a);
  assert.equal(t.focusAdjacent("down"), true);
  assert.equal(t.focusedLeafId, b);
});

test("focusAdjacent returns false when no adjacent leaf exists in that direction", () => {
  const t = new PaneTree({ sessionId: "s1" });
  // Single leaf — no neighbours in any direction.
  assert.equal(t.focusAdjacent("right"), false);
  assert.equal(t.focusAdjacent("up"), false);
});

test("focusAdjacent navigates across nested splits", () => {
  // Tree:   split(v) [ split(h) [a, c], b ]
  // a is top-left, c is bottom-left, b is right column.
  // From `a`, "right" should jump out of the inner horizontal split into b.
  const t = new PaneTree({ sessionId: "s1" });
  const a = t.focusedLeafId;
  const b = t.splitFocused("vertical");
  t.setFocus(a);
  t.splitFocused("horizontal");
  t.setFocus(a);
  assert.equal(t.focusAdjacent("right"), true);
  assert.equal(t.focusedLeafId, b);
});
