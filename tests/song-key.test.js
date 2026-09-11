import assert from "node:assert/strict";
import test from "node:test";
import { CONFIDENCE_FLOOR, inferKey, isDiatonic, rankKeys, romanNumeral, scaleDegree } from "../public/song-key.js";
import { collectSongChords, songChordSequence } from "../public/chord-explorer.js";
import { KEY_CORPUS } from "./fixtures/keys.js";

const song = (rawContent) => ({ rawContent });

/* The corpus is the real specification for the scoring weights. Every song in
   it either has an answer the inference must reach, or is one it must refuse. */
test("every song in the corpus is read as a musician would read it", () => {
  const failures = [];
  for (const entry of KEY_CORPUS) {
    const key = inferKey(entry.chords);
    const want = entry.ambiguous ? null : entry.key || entry.knownLimit;
    const got = key?.confident ? key.name : null;
    if (got !== want) {
      failures.push(`${entry.name}: wanted ${want || "no answer"}, got ${got || "no answer"} (${key.name} at ${key.confidence.toFixed(3)})`);
    }
  }
  assert.deepEqual(failures, []);
});

test("the confidence floor sits clear of both bands of the corpus", () => {
  // A floor wedged between the two bands is what makes holding back meaningful.
  // If these ever cross, the weights need revisiting, not the floor.
  const margins = KEY_CORPUS.map((entry) => ({
    ambiguous: Boolean(entry.ambiguous),
    confidence: inferKey(entry.chords).confidence
  }));
  const nameable = margins.filter((entry) => !entry.ambiguous).map((entry) => entry.confidence);
  const refusable = margins.filter((entry) => entry.ambiguous).map((entry) => entry.confidence);
  const floorOfNameable = Math.min(...nameable);
  const ceilingOfRefusable = Math.max(...refusable);
  assert.ok(ceilingOfRefusable < CONFIDENCE_FLOOR, `refusable reached ${ceilingOfRefusable}`);
  assert.ok(floorOfNameable > CONFIDENCE_FLOOR, `nameable fell to ${floorOfNameable}`);
});

test("repeating a progression does not talk the inference out of its answer", () => {
  /* The margin per chord is not scale-free, because the bonuses for the first
     chord, the last chord and the closing cadence are paid once however long
     the song runs. What matters is that a repeat stays clearly nameable, not
     that the number is identical. */
  const once = inferKey(["Dm7", "G7", "Cmaj7"]);
  const fourTimes = inferKey([...Array(4)].flatMap(() => ["Dm7", "G7", "Cmaj7"]));
  assert.equal(once.name, "C major");
  assert.equal(fourTimes.name, "C major");
  assert.ok(once.confident && fourTimes.confident);
  assert.ok(fourTimes.confidence > CONFIDENCE_FLOOR * 3,
    `a repeat fell to ${fourTimes.confidence.toFixed(3)}, close to the floor`);
});

test("ranks every candidate key so a close call can be inspected", () => {
  const ranked = rankKeys(["C", "F", "G", "C"]);
  assert.equal(ranked.length, 24);
  assert.equal(ranked[0].name, "C major");
  assert.ok(ranked[0].score > ranked[1].score);
  assert.deepEqual(rankKeys(["C"]), []);
});

test("a closing authentic cadence outweighs one that merely stops on the tonic", () => {
  // The pair that ends the song is the strongest evidence there is, and a
  // plagal stop is not given the same weight as a dominant resolving.
  const resolved = rankKeys(["C", "Am", "F", "G", "C"]);
  const stopped = rankKeys(["C", "Am", "G", "F", "C"]);
  const cMajor = (ranked) => ranked.find((entry) => entry.name === "C major").score;
  assert.ok(cMajor(resolved) > cMajor(stopped),
    `${cMajor(resolved)} should beat ${cMajor(stopped)}`);
});

test("a dominant seventh on the tonic and the fourth reads as the blues, not as another key", () => {
  // Without this the twelve-bar in A reads as D major, because there A7 is the
  // diatonic dominant and A major's own tonic chord is not in its scale.
  const blues = inferKey(["A7", "D7", "A7", "A7", "D7", "D7", "A7", "A7", "E7", "D7", "A7", "E7"]);
  assert.equal(blues.name, "A major");
  assert.ok(blues.confident);
});

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
  // Both readings use the same diatonic chords, neither key's dominant appears,
  // and no motion between them cadences, so the candidates tie exactly and
  // naming one would be a guess dressed up as an answer.
  for (const chords of [["C", "Am", "C", "Am"], ["C", "D", "Eb", "F#"]]) {
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

test("the chord's own minor comes off the suffix however it was written", () => {
  // Case carries the third, so the minor marker is dropped and whatever else
  // the symbol says is kept. Every marker a sheet might use has to come off:
  // the degree now sits on every suggestion in the panel, where a numeral that
  // reads "ivin7" or "ivmadd9" is in front of you the whole time.
  const key = inferKey(["A", "E", "Bm", "Dm", "A", "E", "Bm", "Dm"]);
  assert.equal(key.name, "A major");
  for (const chord of ["Dm7", "Dmin7", "D-7"]) assert.equal(romanNumeral(chord, key), "iv7", chord);
  assert.equal(romanNumeral("Dmadd9", key), "ivadd9");
  assert.equal(romanNumeral("Dm13", key), "iv13");
  // "maj" is the one suffix that keeps its m, since it is not the marker.
  assert.equal(romanNumeral("Dmaj9", key), "IVmaj9");
  assert.equal(romanNumeral("Dmmaj7", key), "ivmaj7");
});
