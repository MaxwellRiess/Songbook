import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

test("extension chord parser recognizes grouped transition chords", async () => {
  const source = await readFile(new URL("../extension/chord-utils-content.js", import.meta.url), "utf8");
  const context = { globalThis: {} };
  context.globalThis = context;
  vm.runInNewContext(source, context);

  assert.equal(context.songbookChordUtils.isPlainChordLine("D - (A/C# Bm) / G"), true);
  assert.equal(context.songbookChordUtils.isPlainChordLine("D quick A/C# Bm G"), false);
});
