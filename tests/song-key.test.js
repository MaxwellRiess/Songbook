import assert from "node:assert/strict";
import test from "node:test";
import { CONFIDENCE_FLOOR, inferKey, isDiatonic, romanNumeral, scaleDegree } from "../public/song-key.js";
import { collectSongChords, songChordSequence } from "../public/chord-explorer.js";

const song = (rawContent) => ({ rawContent });

test("names the key of songs that lean on a tonic and its dominant", () => {
  for (const [expected, chords] of [
    ["C major", ["C", "F", "G", "C"]],
    ["G major", ["G", "C", "G", "D", "G", "Em", "D", "G"]],
    ["D major", ["D", "A", "Bm", "G", "D", "A", "D"]],
    ["Bb major", ["Bb", "Eb", "F", "Bb", "Gm", "Cm", "F", "Bb"]],
    ["A minor", ["Am", "Dm", "E7", "Am", "F", "E7", "Am"]],
    ["C major", ["Dm7", "G7", "Cmaj7", "Dm7", "G7", "Cmaj7"]]
  ]) {
    const key = inferKey(chords);
    assert.equal(key.name, expected, chords.join(" "));
    assert.ok(key.confident, `${expected} was only ${key.confidence.toFixed(3)} clear`);
  }
});

test("holds back when a song sits evenly between relative keys", () => {
  // Both readings use the same diatonic chords, and nothing anchors either
  // tonic, so naming one would be a guess dressed up as an answer.
  for (const chords of [["Am", "F", "C", "G"], ["Em", "C", "G", "D"]]) {
    const key = inferKey(chords);
    assert.ok(!key.confident, `${chords.join(" ")} claimed ${key.name} at ${key.confidence.toFixed(3)}`);
  }
});

test("holds back on a progression that fits no key", () => {
  const key = inferKey(["C", "D", "Eb", "F#"]);
  assert.ok(key.confidence < CONFIDENCE_FLOOR);
  assert.ok(!key.confident);
});

test("needs at least two chords to say anything", () => {
  assert.equal(inferKey(["C"]), null);
  assert.equal(inferKey([]), null);
  assert.equal(inferKey(null), null);
  assert.equal(inferKey(["not a chord", "nor this"]), null);
});

test("a repeated tonic outweighs a passing chord", () => {
  // The same chords, but one song keeps returning to G and the other to Em.
  assert.equal(inferKey(["G", "Em", "G", "C", "D", "G", "G"]).name, "G major");
  assert.equal(inferKey(["Em", "G", "Em", "Am", "B7", "Em", "Em"]).name, "E minor");
});

test("numbers the diatonic degrees of a major key", () => {
  const key = inferKey(["C", "F", "G", "C"]);
  assert.deepEqual(
    ["C", "Dm", "Em", "F", "G", "Am", "Bdim"].map((chord) => romanNumeral(chord, key)),
    ["I", "ii", "iii", "IV", "V", "vi", "vii°"]
  );
  assert.deepEqual(
    ["Cmaj7", "Dm7", "G7", "Am7", "Bm7b5"].map((chord) => romanNumeral(chord, key)),
    ["Imaj7", "ii7", "V7", "vi7", "vii7b5"]
  );
});

test("numbers the diatonic degrees of a minor key", () => {
  const key = inferKey(["Am", "Dm", "E7", "Am", "F", "E7", "Am"]);
  assert.deepEqual(
    ["Am", "Bm7b5", "C", "Dm", "Em", "F", "G"].map((chord) => romanNumeral(chord, key)),
    ["i", "ii7b5", "III", "iv", "v", "VI", "VII"]
  );
  // The borrowed major dominant is still the fifth degree, just not diatonic.
  assert.equal(romanNumeral("E7", key), "V7");
  assert.equal(isDiatonic("E7", key), false);
});

test("spells a note outside the scale as a flattened degree above it", () => {
  const key = inferKey(["C", "F", "G", "C"]);
  assert.deepEqual(
    ["Db", "Eb", "Gb", "Ab", "Bb"].map((chord) => romanNumeral(chord, key)),
    ["bII", "bIII", "bV", "bVI", "bVII"]
  );
  assert.equal(romanNumeral("Db7", key), "bII7");
});

test("reads a sharp ninth as a dominant, not a minor chord", () => {
  // A sharp ninth folds onto the minor third, so the ordering of the test for
  // the third decides whether G7#9 is called V7#9 or v7#9.
  const key = inferKey(["C", "F", "G", "C"]);
  assert.equal(romanNumeral("G7#9", key), "V7#9");
  assert.equal(romanNumeral("G7b9", key), "V7b9");
  assert.equal(romanNumeral("Gm7", key), "v7");
});

test("diatonic means every note belongs to the key", () => {
  const key = inferKey(["C", "F", "G", "C"]);
  for (const chord of ["C", "Fmaj7", "Am7", "G7", "Dm9"]) {
    assert.ok(isDiatonic(chord, key), chord);
  }
  for (const chord of ["F7", "Fm", "Cmaj9#11", "A7", "Db7"]) {
    assert.ok(!isDiatonic(chord, key), chord);
  }
  assert.equal(isDiatonic("C", null), false);
});

test("reports the scale degree a chord sits on, or zero when outside it", () => {
  const key = inferKey(["C", "F", "G", "C"]);
  assert.equal(scaleDegree("C", key), 1);
  assert.equal(scaleDegree("F7", key), 4);
  assert.equal(scaleDegree("G", key), 5);
  assert.equal(scaleDegree("Eb", key), 0);
  assert.equal(scaleDegree("C", null), 0);
});

test("the chord sequence keeps repeats and playing order", () => {
  const sheet = ["[Verse]", "C       F", "Amazing grace", "G       C", "how sweet"].join("\n");
  assert.deepEqual(songChordSequence(song(sheet)), ["C", "F", "G", "C"]);
  assert.deepEqual(collectSongChords(song(sheet)), ["C", "F", "G"]);
});

test("a sheet mixing inline markup with chord lines stays in playing order", () => {
  const sheet = ["[ch]G[/ch]Amazing [ch]C[/ch]grace", "D       Em", "how sweet the sound"].join("\n");
  assert.deepEqual(songChordSequence(song(sheet)), ["G", "C", "D", "Em"]);
});

test("the sequence transposes with the viewer", () => {
  assert.deepEqual(songChordSequence(song("[ch]G[/ch]word [ch]Am[/ch]word"), 2), ["A", "Bm"]);
  assert.deepEqual(songChordSequence(null), []);
  assert.deepEqual(songChordSequence(song("")), []);
});
