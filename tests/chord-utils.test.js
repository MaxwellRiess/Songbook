import assert from "node:assert/strict";
import test from "node:test";
import { isChordToken, isPlainChordLine, transposeChordLine } from "../public/chord-utils.js";

test("recognizes parenthesized transition chords in a plain chord line", () => {
  assert.equal(isPlainChordLine("D (A/C# Bm) G"), true);
  assert.equal(isChordToken("(A/C#"), true);
  assert.equal(isChordToken("Bm)"), true);
});

test("allows separator punctuation without treating lyric text as chords", () => {
  assert.equal(isPlainChordLine("D - (A/C# Bm) / G"), true);
  assert.equal(isPlainChordLine("D quick A/C# Bm G"), false);
});

test("transposes grouped transition chords without removing grouping punctuation", () => {
  assert.equal(transposeChordLine("D (A/C# Bm) G", 2), "E (B/D# C#m) A");
});
