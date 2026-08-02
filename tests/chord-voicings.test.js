import assert from "node:assert/strict";
import test from "node:test";
import { STANDARD_TUNING, getVoicings, parseChordSymbol } from "../public/chord-voicings.js";

const asString = (voicing) => voicing.frets.map((fret) => (fret === null ? "x" : fret)).join("-");

test("parses roots, qualities and slash bass notes", () => {
  assert.equal(parseChordSymbol("C").qualityName, "major");
  assert.equal(parseChordSymbol("Am7").qualityName, "minor 7th");
  assert.equal(parseChordSymbol("CM7").qualityName, "major 7th");
  assert.equal(parseChordSymbol("Cm7").qualityName, "minor 7th");
  assert.equal(parseChordSymbol("Bbmaj9").root, "Bb");
  assert.equal(parseChordSymbol("D/F#").bass, "F#");
  assert.deepEqual(parseChordSymbol("C").notes, ["C", "E", "G"]);
  assert.deepEqual(parseChordSymbol("Am7").notes, ["A", "C", "E", "G"]);
});

test("handles alterations that are not spelled out in the quality table", () => {
  const parsed = parseChordSymbol("G7b9");
  assert.ok(parsed);
  assert.deepEqual(parsed.notes, ["G", "B", "D", "F", "Ab"]);
});

test("rejects things that are not chords", () => {
  assert.equal(parseChordSymbol("Hmm"), null);
  assert.equal(parseChordSymbol("|"), null);
  assert.equal(parseChordSymbol("Cwobble"), null);
});

test("leads with the shape a guitarist already knows", () => {
  assert.equal(asString(getVoicings("C")[0]), "x-3-2-0-1-0");
  assert.equal(asString(getVoicings("Am")[0]), "x-0-2-2-1-0");
  assert.equal(asString(getVoicings("G")[0]), "3-2-0-0-0-3");
  assert.equal(asString(getVoicings("D")[0]), "x-x-0-2-3-2");
  assert.equal(asString(getVoicings("F")[0]), "1-3-3-2-1-1");
  assert.equal(asString(getVoicings("D/F#")[0]), "2-0-0-2-3-2");
});

test("works up the neck without repeating a position", () => {
  const voicings = getVoicings("Am7");
  assert.ok(voicings.length >= 4);

  const positions = voicings.map((voicing) => voicing.position);
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.equal(new Set(positions).size, positions.length);
});

test("every shape is playable and spells the chord", () => {
  for (const symbol of ["C", "Am7", "F#m", "Bb13", "Esus4", "Dm9", "G/B", "Cdim7"]) {
    const parsed = parseChordSymbol(symbol);
    const voicings = getVoicings(symbol);
    assert.ok(voicings.length, `${symbol} produced no shapes`);

    const allowed = new Set(parsed.intervals.map((interval) => (parsed.rootPc + interval) % 12));
    if (parsed.bassPc !== null) allowed.add(parsed.bassPc);

    for (const voicing of voicings) {
      const sounded = voicing.frets
        .map((fret, string) => (fret === null ? null : { fret, string }))
        .filter(Boolean);

      assert.ok(voicing.fingerCount <= 4, `${symbol} ${asString(voicing)} needs too many fingers`);
      assert.ok(voicing.span <= 3, `${symbol} ${asString(voicing)} stretches too far`);

      for (const { fret, string } of sounded) {
        const pitchClass = (STANDARD_TUNING[string] + fret) % 12;
        assert.ok(allowed.has(pitchClass), `${symbol} ${asString(voicing)} plays a foreign note`);
      }

      // No muted string sandwiched between two sounded ones.
      const gap = voicing.frets
        .slice(sounded[0].string, sounded[sounded.length - 1].string + 1)
        .some((fret) => fret === null);
      assert.equal(gap, false, `${symbol} ${asString(voicing)} mutes an inner string`);

      // The lowest sounded note is the root, or the bass note of a slash chord.
      const bass = (STANDARD_TUNING[sounded[0].string] + sounded[0].fret) % 12;
      assert.equal(bass, parsed.bassPc === null ? parsed.rootPc : parsed.bassPc);
    }
  }
});

test("names the notes under each string", () => {
  const [open] = getVoicings("Em");
  assert.deepEqual(open.noteNames, ["E", "B", "E", "G", "B", "E"]);
});

test("returns nothing for an unparseable symbol", () => {
  assert.deepEqual(getVoicings("Nope"), []);
});
