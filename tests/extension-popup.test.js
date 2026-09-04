import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("retries the Songbook import instead of waiting for a tab-complete event", async () => {
  const source = await readFile(new URL("../extension/popup.js", import.meta.url), "utf8");
  const elements = new Map();
  const removedTabs = [];
  const importedIds = [];
  let importAttempts = 0;

  const context = {
    URL,
    crypto: webcrypto,
    setTimeout,
    clearTimeout,
    document: {
      querySelector(selector) {
        if (!elements.has(selector)) elements.set(selector, fakeElement());
        return elements.get(selector);
      }
    },
    chrome: {
      storage: {
        local: {
          get(_keys, callback) { callback({ appUrl: "https://maxwellriess.github.io/Songbook" }); },
          set() {}
        }
      },
      tabs: {
        async query(options) {
          if (options.active) {
            return [{ id: 7, url: "https://guitartuna.com/chords/sovay" }];
          }
          return [];
        },
        async create() { return { id: 8, status: "loading", discarded: false }; },
        async reload() {},
        async remove(tabId) { removedTabs.push(tabId); }
      },
      scripting: {
        async executeScript(options) {
          if (options.files) return [{}];
          if (options.func?.name === "extractSongFromLoadedPage") {
            return [{ result: { song: { title: "Sovay", artist: "James Yorkston", rawContent: "Am\nLyrics" } } }];
          }
          if (options.func?.name === "importSongIntoSongbookPage") {
            importAttempts += 1;
            importedIds.push(options.args[0].id);
            if (importAttempts < 3) throw new Error("The tab has no committed document yet.");
            return [{ result: options.args[0] }];
          }
          throw new Error("Unexpected script injection");
        }
      }
    }
  };
  context.globalThis = context;
  vm.runInNewContext(source, context);

  await context.clipCurrentTab();

  assert.equal(importAttempts, 3);
  assert.equal(new Set(importedIds).size, 1, "every retry uses the same song id");
  assert.deepEqual(removedTabs, [8]);
  assert.equal(elements.get("#pageStatus").textContent, "Done");
  assert.equal(elements.get("#message").textContent, "Saved to Songbook.");
});

function fakeElement() {
  return {
    value: "",
    textContent: "",
    disabled: false,
    addEventListener() {},
    classList: {
      add() {},
      remove() {},
      toggle() {}
    }
  };
}
