import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../public/appearance.js", import.meta.url), "utf8");
function boot(entries = {}, systemDark = false, blockedStorage = false) {
  const storage = new Map(Object.entries(entries));
  const root = { dataset: {} };
  let color;
  const window = { matchMedia: () => ({ matches: systemDark }) };
  runInNewContext(source, {
    window,
    document: {
      documentElement: root,
      querySelector: () => ({ setAttribute: (_key, value) => { color = value; } })
    },
    localStorage: {
      getItem(key) { if (blockedStorage) throw new Error("Storage unavailable"); return storage.get(key) ?? null; },
      setItem(key, value) { if (blockedStorage) throw new Error("Storage unavailable"); storage.set(key, value); },
      removeItem(key) { storage.delete(key); }
    }
  });
  return { root, storage, apply: window.SongbookAppearance.apply, color: () => color };
}

test("saved light or dark appearance takes precedence over old themes and system settings", () => {
  assert.equal(boot({"songbook.mode":"light", "songbook.theme":"stage"}, true).root.dataset.mode, "light");
  assert.equal(boot({"songbook.mode":"dark", "songbook.theme":"editorial"}).root.dataset.mode, "dark");
});
test("old stage theme stays dark; previous light themes stay light", () => {
  for (const theme of ["stage", "vintage", "zine", "analog", "editorial", ""]) {
    assert.equal(boot({"songbook.theme":theme}, true).root.dataset.mode, theme === "stage" ? "dark" : "light");
  }
});
test("new installations use the system appearance and tolerate invalid saved modes", () => {
  assert.equal(boot({}, true).root.dataset.mode, "dark");
  assert.equal(boot().root.dataset.mode, "light");
  assert.equal(boot({"songbook.mode":"invalid"}, true).root.dataset.mode, "dark");
});
test("changing appearance saves the choice, removes the legacy setting and updates browser chrome", () => {
  const app = boot({"songbook.theme":"stage"});
  app.apply("light");
  assert.equal(app.root.dataset.mode, "light");
  assert.equal(app.storage.get("songbook.mode"), "light");
  assert.equal(app.storage.has("songbook.theme"), false);
  assert.equal(app.color(), "#e1e6dc");
  assert.equal(boot(Object.fromEntries(app.storage), true).root.dataset.mode, "light");
  app.apply("dark");
  assert.equal(app.color(), "#19211c");
});
test("appearance changes still work when storage is blocked", () => {
  const app = boot({}, true, true);
  assert.equal(app.root.dataset.mode, "dark");
  assert.doesNotThrow(() => app.apply("light"));
  assert.equal(app.root.dataset.mode, "light");
});
