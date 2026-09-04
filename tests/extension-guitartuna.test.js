import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadGuitarTunaReader() {
  const source = await readFile(new URL("../extension/guitartuna-content.js", import.meta.url), "utf8");
  const context = { globalThis: {} };
  context.globalThis = context;
  vm.runInNewContext(source, context);
  return context.songbookGuitarTuna;
}

test("places each chord at the column its preceding beat widths add up to", async () => {
  const { buildChordSheet } = await loadGuitarTunaReader();

  const sheet = buildChordSheet([
    { type: "section", label: "Verse 1" },
    {
      type: "line",
      lyric: "As it fell out upon a day",
      chords: [{ column: 0, chord: "Am " }]
    },
    {
      type: "line",
      lyric: "as many in the air",
      chords: [{ column: 11, chord: "C" }]
    }
  ]);

  assert.equal(sheet, [
    "[Verse 1]",
    "Am",
    "As it fell out upon a day",
    "           C",
    "as many in the air"
  ].join("\n"));
});

test("keeps a gap between chords that share a beat column", async () => {
  const { buildChordSheet } = await loadGuitarTunaReader();

  const sheet = buildChordSheet([
    {
      type: "line",
      lyric: "This lady's love I've won",
      chords: [
        { column: 5, chord: "F" },
        { column: 5, chord: "Dm" },
        { column: 12, chord: "F" }
      ]
    }
  ]);

  assert.equal(sheet, ["     F Dm   F", "This lady's love I've won"].join("\n"));
});

test("separates parts with a blank line and drops chordless empty rows", async () => {
  const { buildChordSheet } = await loadGuitarTunaReader();

  const sheet = buildChordSheet([
    { type: "section", label: "Intro" },
    { type: "line", lyric: "", chords: [{ column: 0, chord: "G" }] },
    { type: "line", lyric: "", chords: [] },
    { type: "section", label: "Chorus" },
    { type: "line", lyric: "the fairest of them all", chords: [] }
  ]);

  assert.equal(sheet, ["[Intro]", "G", "", "[Chorus]", "the fairest of them all"].join("\n"));
});

test("normalizes GuitarTuna song details from schema.org metadata", async () => {
  const { extractSong } = await loadGuitarTunaReader();

  const song = extractSong(fakeDocument());

  assert.equal(song.title, "Little Musgrave");
  assert.equal(song.artist, "James Yorkston, The Big Eyes Family Players");
  assert.equal(song.key, "Am");
  assert.equal(song.tuning, "E A D G B E");
  assert.equal(song.capo, "");
  assert.equal(song.tags.join(" "), "clipped guitartuna");
  assert.equal(song.rawContent, ["[Verse 1]", "   C", "as many in the air"].join("\n"));
});

test("reads GuitarTuna's current capo wording from the Sovay page", async () => {
  const { extractSong } = await loadGuitarTunaReader();

  const song = extractSong(fakeDocument({
    heading: "Sovay easy guitar chords by James Yorkston, The Big Eyes Family Players",
    schema: {
      "@type": "MusicComposition",
      name: "Sovay (chords)",
      composer: { "@type": "Person", name: "James Yorkston, The Big Eyes Family Players" },
      musicalKey: "C minor",
      text: "Tuning: E A D G B E Key: C minor Capo: fret 3 Tempo: 32 BPM"
    }
  }));

  assert.equal(song.title, "Sovay");
  assert.equal(song.artist, "James Yorkston, The Big Eyes Family Players");
  assert.equal(song.key, "Cm");
  assert.equal(song.capo, "3");
  assert.equal(song.tuning, "E A D G B E");
});

test("falls back to GuitarTuna's descriptive heading when schema metadata is absent", async () => {
  const { extractSong } = await loadGuitarTunaReader();

  const song = extractSong(fakeDocument({
    heading: "Sovay easy guitar chords by James Yorkston, The Big Eyes Family Players",
    schema: null
  }));

  assert.equal(song.title, "Sovay");
  assert.equal(song.artist, "James Yorkston, The Big Eyes Family Players");
});

// A stand-in for the slice of the DOM the reader walks, so the extraction path
// can be exercised without a browser.
function fakeDocument({
  heading = "LITTLE MUSGRAVE chords by James Yorkston",
  schema = {
    "@type": "MusicComposition",
    name: "Little Musgrave (chords)",
    composer: { "@type": "Person", name: "James Yorkston, The Big Eyes Family Players" },
    musicalKey: "A minor",
    text: "Tuning: E A D G B E Key: A minor Tempo: 77 BPM"
  }
} = {}) {
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

  const jsonLd = schema ? [element({
    tag: "SCRIPT",
    attributes: { type: "application/ld+json" },
    text: JSON.stringify(schema)
  })] : [];

  const headingElement = element({ tag: "H1", text: heading });
  const doc = element({ tag: "BODY", children: [headingElement, ...jsonLd, root] });
  doc.location = { href: "https://guitartuna.com/chords/little-musgrave" };
  return doc;
}

function element({ tag, classes = [], attributes = {}, properties = {}, children = [], text = "" }) {
  const node = {
    tagName: tag,
    children,
    classList: { contains: (name) => classes.includes(name) },
    style: { getPropertyValue: (name) => properties[name] || "" },
    getAttribute: (name) => attributes[name] ?? null,
    get textContent() {
      return text || children.map((child) => child.textContent).join("");
    },
    querySelector: (selector) => node.querySelectorAll(selector)[0] || null,
    querySelectorAll: (selector) => descendants(node).filter((candidate) => matches(candidate, selector))
  };
  return node;
}

function descendants(node) {
  return node.children.flatMap((child) => [child, ...descendants(child)]);
}

function matches(node, selector) {
  return selector.split(",").some((part) => {
    const trimmed = part.trim();
    if (trimmed.startsWith(".")) return node.classList.contains(trimmed.slice(1));
    if (trimmed.startsWith("[")) {
      const [, name, value] = trimmed.match(/^\[([^\]=]+)(?:="([^"]*)")?\]$/) || [];
      return name ? node.getAttribute(name) !== null && (value === undefined || node.getAttribute(name) === value) : false;
    }
    if (trimmed.startsWith("#")) return false;
    const [tag, attribute] = trimmed.split(/(?=\[)/);
    if (node.tagName !== tag.toUpperCase()) return false;
    return attribute ? matches(node, attribute) : true;
  });
}
