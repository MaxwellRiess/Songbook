import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { buildShortcutSnippet, OUTPUT_FILE } from "../scripts/build-shortcut.js";
import { decodeClipPayload } from "../public/clip-import.js";
import { element } from "./fixtures/fake-dom.js";

const ROOT = new URL("../", import.meta.url);
const APP_URL = "https://maxwellriess.github.io/Songbook";

test("the published snippet matches the sources it is built from", async () => {
  const published = await readFile(new URL(OUTPUT_FILE, ROOT), "utf8");
  assert.equal(published, await buildShortcutSnippet(ROOT), `${OUTPUT_FILE} is stale; run \`npm run build:shortcut\``);
});

test("hands back an import URL the app decodes into the clipped song", async () => {
  const result = await runSnippet(guitarTunaDocument());

  assert.ok(result.url.startsWith(`${APP_URL}/#import=`), `unexpected URL: ${result.url.slice(0, 80)}`);
  assert.equal(result.title, "Little Musgrave");
  assert.equal(result.artist, "James Yorkston");

  const song = decodeClipPayload(result.url.split("#import=")[1]);
  assert.equal(song.title, "Little Musgrave");
  assert.equal(song.key, "Am");
  assert.equal(song.sourceUrl, "https://guitartuna.com/chords/little-musgrave");
  assert.deepEqual(song.tags, ["clipped", "guitartuna"]);
  assert.equal(song.rawContent, ["[Verse 1]", "   C", "as many in the air"].join("\n"));
});

// The app mints the id on the way in, so a payload carrying one would be the
// snippet deciding something it cannot see the library to decide.
test("leaves the song id to the app", async () => {
  const result = await runSnippet(guitarTunaDocument());
  assert.equal(decodeClipPayload(result.url.split("#import=")[1]).id, undefined);
});

test("reports a page it cannot read instead of opening the app", async () => {
  const empty = element({ tag: "BODY", children: [] });
  empty.location = { href: "https://guitartuna.com/chords/nothing-here" };

  const result = await runSnippet(empty);

  assert.equal(result.url, undefined);
  assert.match(result.error, /No GuitarTuna chord sheet/);
});

test("says which pages it clips when run somewhere else", async () => {
  const elsewhere = element({ tag: "BODY", children: [] });
  elsewhere.location = { href: "https://example.com/songs/1" };

  const result = await runSnippet(elsewhere);

  assert.equal(result.url, undefined);
  assert.match(result.error, /Ultimate Guitar or GuitarTuna/);
});

// The extension injects these same readers, where no completion function exists.
test("defines the readers without clipping when nothing is waiting on a result", async () => {
  const context = baseContext(guitarTunaDocument());
  vm.runInNewContext(await readFile(new URL(OUTPUT_FILE, ROOT), "utf8"), context);

  assert.equal(typeof context.songbookClipper?.extractSong, "function");
  assert.equal(typeof context.songbookUltimateGuitar?.extractSong, "function");
});

async function runSnippet(document) {
  const context = baseContext(document);
  const clipped = new Promise((resolve) => {
    context.completion = resolve;
  });

  vm.runInNewContext(await readFile(new URL(OUTPUT_FILE, ROOT), "utf8"), context);

  return clipped;
}

function baseContext(document) {
  const context = { document, URL, TextEncoder, btoa, globalThis: {} };
  context.globalThis = context;
  return context;
}

function guitarTunaDocument() {
  const chord = element({ tag: "SPAN", attributes: { "data-chord": "C " } });
  const beats = [
    element({ tag: "DIV", classes: ["beat_info"], properties: { "--w": "3" } }),
    element({ tag: "DIV", classes: ["beat_info"], properties: { "--w": "4" }, children: [chord] })
  ];
  const lyric = element({ tag: "DIV", text: "as many in the air" });
  const line = element({ tag: "DIV", classes: ["line"], children: [...beats, lyric] });
  const part = element({
    tag: "DIV",
    classes: ["partContainer"],
    children: [element({ tag: "DIV", classes: ["part_type"], text: "Verse 1" })]
  });
  const root = element({ tag: "DIV", classes: ["lyrics-root"], children: [part, line] });

  const jsonLd = element({
    tag: "SCRIPT",
    attributes: { type: "application/ld+json" },
    text: JSON.stringify({
      "@type": "MusicComposition",
      name: "Little Musgrave (chords)",
      composer: { "@type": "Person", name: "James Yorkston" },
      musicalKey: "A minor",
      text: "Tuning: E A D G B E Key: A minor Tempo: 77 BPM"
    })
  });

  const doc = element({ tag: "BODY", children: [element({ tag: "H1", text: "" }), jsonLd, root] });
  doc.location = { href: "https://guitartuna.com/chords/little-musgrave" };
  return doc;
}
