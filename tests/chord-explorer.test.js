import assert from "node:assert/strict";
import test from "node:test";
import { collectSongChords } from "../public/chord-explorer.js";

const song = (rawContent) => ({ rawContent });

test("collects chords from Ultimate Guitar markup in order of first use", () => {
  const chords = collectSongChords(
    song("[ch]G[/ch]Amazing [ch]C[/ch]grace, how [ch]G[/ch]sweet the [ch]D[/ch]sound")
  );
  assert.deepEqual(chords, ["G", "C", "D"]);
});

test("collects chords from plain chord lines and strips grouping punctuation", () => {
  const chords = collectSongChords(song(["[Verse]", "D - (A/C# Bm) / G", "Some lyrics here"].join("\n")));
  assert.deepEqual(chords, ["D", "A/C#", "Bm", "G"]);
});

test("applies the viewer transpose so chips match what is on screen", () => {
  assert.deepEqual(collectSongChords(song("[ch]G[/ch]word [ch]Am[/ch]word"), 2), ["A", "Bm"]);
});

test("skips tokens that are not chords the generator can read", () => {
  const chords = collectSongChords(song(["Am  N.C.  Bm", "I met my love by the gas works wall"].join("\n")));
  assert.deepEqual(chords, ["Am", "Bm"]);
});

test("returns nothing without a song", () => {
  assert.deepEqual(collectSongChords(null), []);
  assert.deepEqual(collectSongChords(song("")), []);
});
