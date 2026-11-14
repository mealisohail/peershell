import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore, type StorageAdapter } from "./store.ts";
import { DEFAULT_FONT_SETTINGS, DEFAULT_THEME } from "../terminal/types.ts";

function inMemoryStorage(): StorageAdapter {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
}

test("fresh store has no tabs and default settings", () => {
  const s = createStore({ storage: inMemoryStorage() });
  const state = s.snapshot();
  assert.deepEqual(state.tabs, []);
  assert.equal(state.activeTabId, null);
  assert.equal(state.settings.theme, DEFAULT_THEME);
  assert.equal(state.settings.family, DEFAULT_FONT_SETTINGS.family);
  assert.equal(state.settings.size, DEFAULT_FONT_SETTINGS.size);
});

test("addTab appends, activates, and assigns a unique id", () => {
  const s = createStore({ storage: inMemoryStorage() });
  const id1 = s.addTab({ title: "A", originalSessionId: "sess-1" });
  const id2 = s.addTab({ title: "B", originalSessionId: "sess-1" });
  const state = s.snapshot();
  assert.equal(state.tabs.length, 2);
  assert.equal(state.tabs[0]!.id, id1);
  assert.equal(state.tabs[1]!.id, id2);
  assert.equal(state.activeTabId, id2);
  assert.notEqual(id1, id2);
});

test("removeTab removes and re-activates a neighbour", () => {
  const s = createStore({ storage: inMemoryStorage() });
  const a = s.addTab({ title: "A", originalSessionId: "x" });
  const b = s.addTab({ title: "B", originalSessionId: "x" });
  const c = s.addTab({ title: "C", originalSessionId: "x" });
  s.removeTab(b);
  const state = s.snapshot();
  assert.equal(state.tabs.length, 2);
  // Active was C (last added); removing the middle one leaves C still active.
  assert.equal(state.activeTabId, c);
  // Remove the active one; the right-neighbour, falling back to left.
  s.removeTab(c);
  assert.equal(s.snapshot().activeTabId, a);
  s.removeTab(a);
  assert.equal(s.snapshot().activeTabId, null);
});

test("setActiveTab updates the active tab", () => {
  const s = createStore({ storage: inMemoryStorage() });
  const a = s.addTab({ title: "A", originalSessionId: "x" });
  const b = s.addTab({ title: "B", originalSessionId: "x" });
  s.setActiveTab(a);
  assert.equal(s.snapshot().activeTabId, a);
  s.setActiveTab(b);
  assert.equal(s.snapshot().activeTabId, b);
});

test("renameTab updates the title", () => {
  const s = createStore({ storage: inMemoryStorage() });
  const id = s.addTab({ title: "Untitled", originalSessionId: "x" });
  s.renameTab(id, "Production shell");
  assert.equal(s.snapshot().tabs[0]!.title, "Production shell");
});

test("setTabColor updates the color", () => {
  const s = createStore({ storage: inMemoryStorage() });
  const id = s.addTab({ title: "A", originalSessionId: "x" });
  s.setTabColor(id, "blue");
  assert.equal(s.snapshot().tabs[0]!.color, "blue");
  s.setTabColor(id, null);
  assert.equal(s.snapshot().tabs[0]!.color, null);
});

test("reorderTab moves a tab to a new index", () => {
  const s = createStore({ storage: inMemoryStorage() });
  const a = s.addTab({ title: "A", originalSessionId: "x" });
  const b = s.addTab({ title: "B", originalSessionId: "x" });
  const c = s.addTab({ title: "C", originalSessionId: "x" });
  s.reorderTab(a, 2);
  const titles = s.snapshot().tabs.map((t) => t.id);
  assert.deepEqual(titles, [b, c, a]);
});

test("settings are mutable and observable", () => {
  const s = createStore({ storage: inMemoryStorage() });
  let count = 0;
  s.subscribe(() => count++);
  s.setTheme("tokyo-night");
  s.setFontFamily("jetbrains-mono");
  s.setFontSize(16);
  const state = s.snapshot();
  assert.equal(state.settings.theme, "tokyo-night");
  assert.equal(state.settings.family, "jetbrains-mono");
  assert.equal(state.settings.size, 16);
  assert.ok(count >= 3);
});

test("setFontSize clamps to 10..24", () => {
  const s = createStore({ storage: inMemoryStorage() });
  s.setFontSize(200);
  assert.equal(s.snapshot().settings.size, 24);
  s.setFontSize(2);
  assert.equal(s.snapshot().settings.size, 10);
});

test("persistence: state survives a re-creation of the store", () => {
  const storage = inMemoryStorage();
  const s1 = createStore({ storage });
  const tabId = s1.addTab({
    title: "Production",
    originalSessionId: "sess-1",
  });
  s1.setTabColor(tabId, "red");
  s1.setTheme("solarized-dark");
  s1.setFontSize(18);

  const s2 = createStore({ storage });
  const state = s2.snapshot();
  assert.equal(state.tabs.length, 1);
  assert.equal(state.tabs[0]!.title, "Production");
  assert.equal(state.tabs[0]!.color, "red");
  assert.equal(state.tabs[0]!.originalSessionId, "sess-1");
  assert.equal(state.settings.theme, "solarized-dark");
  assert.equal(state.settings.size, 18);
});

test("subscribe receives the latest state on every mutation", () => {
  const s = createStore({ storage: inMemoryStorage() });
  const seen: number[] = [];
  s.subscribe((state) => seen.push(state.tabs.length));
  s.addTab({ title: "A", originalSessionId: "x" });
  s.addTab({ title: "B", originalSessionId: "x" });
  s.removeTab(s.snapshot().tabs[0]!.id);
  assert.deepEqual(seen, [1, 2, 1]);
});

test("unsubscribe stops further notifications", () => {
  const s = createStore({ storage: inMemoryStorage() });
  let count = 0;
  const unsub = s.subscribe(() => count++);
  s.addTab({ title: "A", originalSessionId: "x" });
  unsub();
  s.addTab({ title: "B", originalSessionId: "x" });
  assert.equal(count, 1);
});

test("hydrate gracefully ignores malformed persisted data", () => {
  const storage = inMemoryStorage();
  storage.setItem("peershell.state", "not-json{{{");
  const s = createStore({ storage });
  // Falls back to defaults rather than throwing.
  assert.deepEqual(s.snapshot().tabs, []);
  assert.equal(s.snapshot().settings.theme, DEFAULT_THEME);
});
